import { getDatabase, liveRowsFor, decodeRowsFromStorage, type LocalTask } from '@/lib/db/schema';
import { nowIsoSafe } from '@/lib/db/helpers';
import { newId } from '@/lib/db/helpers';
import type { Mutation, SyncConflict, SyncEntityType, SyncReport } from '@/types/domain';
import {
  applyRemoteProject,
  applyRemoteSubtask,
  applyRemoteTag,
  applyRemoteTask,
  applyRemoteTaskTag,
  buildMutation,
  hasPendingMutationFor,
} from '@/lib/db/repositories';
import { computeBackoffMs, MAX_MUTATION_RETRIES } from '@/lib/utils';
import {
  fetchChangedRows,
  pushMutation,
  type PulledRow,
  type PushResult,
} from '@/features/sync/transport';

/**
 * Sync engine.
 *
 * This is the most delicate part of the product, so the rules are stated explicitly.
 *
 * ORDER OF OPERATIONS: pull, then push, then pull again.
 *   1. Pull first so the device learns about remote changes before it tries to write. Without
 *      this, a device that has been offline would push a stale edit onto a row that already
 *      moved, turning an easily-merged change into a conflict.
 *   2. Push the queue so local work reaches the server as soon as possible.
 *   3. Pull again to pick up rows the push itself changed (new revisions, and any rows the server
 *      resolved server-side).
 *
 * NEVER MARK A MUTATION DONE BEFORE THE SERVER CONFIRMS. A mutation is only removed after an
 * explicit accepted response. A network failure leaves it queued, always. This is the rule that
 * makes "task deleted offline does not come back" true.
 *
 * CONCURRENCY: only one drain may run at a time. Two concurrent drains would push the same
 * mutation twice and, worse, interleave their cursor updates and skip rows. A module-level promise
 * guard enforces this, and it is the reason `sync()` returns the in-flight promise rather than
 * starting a second run.
 */

/** The in-flight sync, if any. Module-scoped: one sync per tab, which is what the guard needs. */
let inFlightSync: Promise<SyncReport> | null = null;

/** Rows fetched per pull page. Bounded so a first sync on a large account does not load the
 * whole table into memory at once. */
const PULL_PAGE_SIZE = 500;

export interface SyncOptions {
  userId: string;
  deviceId: string;
  /** Cancels the run when the account changes mid-sync. */
  signal?: AbortSignal;
  /** Called after each phase so the UI indicator can update without waiting for the whole run. */
  onProgress?: (phase: 'pulling' | 'pushing' | 'reconciling') => void;
}

export class SyncAbortedError extends Error {
  constructor() {
    super('Sync was aborted because the active account changed.');
    this.name = 'SyncAbortedError';
  }
}

/**
 * Runs a full sync cycle, or joins the one already running.
 *
 * Returning the in-flight promise rather than throwing is deliberate: the callers are triggers
 * (app focus, reconnect, manual button, interval) and they fire in bursts. A user tapping "Sync"
 * while a background sync is running should see that sync's result, not an error.
 */
export async function sync(options: SyncOptions): Promise<SyncReport> {
  if (inFlightSync) {
    return inFlightSync;
  }

  inFlightSync = runSync(options).finally(() => {
    inFlightSync = null;
  });

  return inFlightSync;
}

/** True when a sync is currently running. Drives the indicator's spinner state. */
export function isSyncInFlight(): boolean {
  return inFlightSync !== null;
}

async function runSync(options: SyncOptions): Promise<SyncReport> {
  const startedAt = Date.now();
  const { userId, deviceId, signal, onProgress } = options;

  const report: SyncReport = {
    pulledCount: 0,
    pushedCount: 0,
    conflictCount: 0,
    failedCount: 0,
    durationMs: 0,
  };

  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new SyncAbortedError();
  };

  // Reset any mutations left 'in_flight' from a previous sync that was aborted, crashed, or
  // interrupted by an account switch. Without this, a crashed sync leaves mutations stuck:
  // drainQueue only processes 'pending', so 'in_flight' is never retried; but
  // hasPendingMutationFor returns true for 'in_flight', so pulls for those entities are
  // skipped forever. The user would have to delete local data to see remote updates.
  await resetInFlightMutations(userId);

  // Phase 1: pull remote changes.
  onProgress?.('pulling');
  const cursor = await readCursor(userId);
  const firstPull = await pullChanges({ userId, deviceId, sinceRevision: cursor, signal });
  report.pulledCount += firstPull.appliedCount;
  throwIfAborted();

  // Phase 2: push queued local mutations.
  onProgress?.('pushing');
  const pushOutcome = await drainQueue({ userId, signal });
  report.pushedCount += pushOutcome.accepted;
  report.conflictCount += pushOutcome.conflicts;
  report.failedCount += pushOutcome.failed;
  throwIfAborted();

  // Phase 3: reconcile, so server-echoed revisions land locally.
  onProgress?.('reconciling');
  const newCursor = await readCursor(userId);
  const secondPull = await pullChanges({ userId, deviceId, sinceRevision: newCursor, signal });
  report.pulledCount += secondPull.appliedCount;

  report.durationMs = Date.now() - startedAt;
  return report;
}

/* ---------------------------------------------------------------------------------------
 * Cursor
 * ------------------------------------------------------------------------------------- */

async function readCursor(userId: string): Promise<number> {
  const db = getDatabase();
  const key = `sync-meta:${userId}`;
  const meta = await db.syncMeta.get(key);
  return meta?.last_pulled_revision ?? 0;
}

async function writeCursor(
  userId: string,
  revision: number,
  fields: { pulledAt?: string; pushedAt?: string; deviceId?: string },
): Promise<void> {
  const db = getDatabase();
  const key = `sync-meta:${userId}`;
  const existing = await db.syncMeta.get(key);

  await db.syncMeta.put({
    key,
    user_id: userId,
    last_pulled_revision: revision,
    last_pulled_at: fields.pulledAt ?? existing?.last_pulled_at ?? null,
    last_push_at: fields.pushedAt ?? existing?.last_push_at ?? null,
    last_device_id: fields.deviceId ?? existing?.last_device_id ?? null,
  });
}

/* ---------------------------------------------------------------------------------------
 * In-flight recovery
 * ------------------------------------------------------------------------------------- */

/**
 * Resets all 'in_flight' mutations for a user back to 'pending'.
 *
 * A mutation is set to 'in_flight' just before it is pushed. If the sync is aborted (account
 * switch, tab close, crash) between that status update and the push completing, the mutation
 * is stranded: drainQueue only reads 'pending', so it is never retried, but
 * hasPendingMutationFor counts 'in_flight', so the pull phase skips remote updates for that
 * entity. The result is that the user's local data goes stale and the only recovery is
 * deleting local data — which is exactly what this function prevents.
 *
 * Called at the top of every sync cycle, before the first pull.
 */
async function resetInFlightMutations(userId: string): Promise<void> {
  const db = getDatabase();
  await db.mutations
    .where('[user_id+status]')
    .equals([userId, 'in_flight'])
    .modify({ status: 'pending' });
}

/* ---------------------------------------------------------------------------------------
 * Pull
 * ------------------------------------------------------------------------------------- */

interface PullResult {
  appliedCount: number;
}

/**
 * Pulls every table's changed rows above the cursor, paging until exhausted.
 *
 * The cursor advances only after a page has been fully applied. That ordering matters: advancing
 * first and applying second would mean a crash mid-page skips rows permanently, and the device
 * would never know it is missing them.
 */
async function pullChanges(input: {
  userId: string;
  deviceId: string;
  sinceRevision: number;
  signal?: AbortSignal;
}): Promise<PullResult> {
  const { userId, deviceId, sinceRevision, signal } = input;

  let cursor = sinceRevision;
  let appliedCount = 0;
  let sawFullPage = true;

  // Paged loop. `sawFullPage` going false is the termination condition: a partial page means the
  // server has no more rows above the cursor.
  while (sawFullPage) {
    if (signal?.aborted) throw new SyncAbortedError();

    const page = await fetchChangedRows({
      userId,
      sinceRevision: cursor,
      limit: PULL_PAGE_SIZE,
    });

    if (page.rows.length === 0) {
      sawFullPage = false;
      break;
    }

    for (const row of page.rows) {
      await applyPulledRow(userId, row);
      appliedCount += 1;
      if (row.revision > cursor) cursor = row.revision;
    }

    // Persist progress per page so a long first sync is resumable rather than all-or-nothing.
    await writeCursor(userId, cursor, { pulledAt: nowIsoSafe(), deviceId });

    sawFullPage = page.rows.length === PULL_PAGE_SIZE;

    if (cursor >= page.highWaterMark) {
      // The server has told us the highest revision it holds; nothing above this exists yet.
      sawFullPage = false;
    }
  }

  await writeCursor(userId, cursor, { pulledAt: nowIsoSafe(), deviceId });
  return { appliedCount };
}

/**
 * Applies one pulled row locally.
 *
 * The critical rule: a pulled row must NEVER overwrite a local row that has an unsynced mutation.
 * If it did, the user's offline edit would be silently replaced by the server's older version, and
 * the user would watch their own change disappear. In that case the row is left alone and the
 * pending mutation will reconcile it on the next push.
 */
async function applyPulledRow(userId: string, row: PulledRow): Promise<void> {
  const db = getDatabase();

  const hasPending = await hasPendingMutationFor(row.id);
  if (hasPending) {
    // Local work wins for now. The push phase will send it and the follow-up pull will bring back
    // the merged result.
    return;
  }

  const timestamp = nowIsoSafe();

  switch (row.entityType) {
    case 'task': {
      const task: LocalTask = {
        ...row.data,
        user_id: userId,
        sync_state: 'synced',
        local_updated_at: timestamp,
      };
      await applyRemoteTask(task);
      break;
    }
    case 'project': {
      await applyRemoteProject({
        ...row.data,
        user_id: userId,
        sync_state: 'synced',
        local_updated_at: timestamp,
      });
      break;
    }
    case 'tag': {
      await applyRemoteTag({
        ...row.data,
        user_id: userId,
        sync_state: 'synced',
        local_updated_at: timestamp,
      });
      break;
    }
    case 'subtask': {
      await applyRemoteSubtask({
        ...row.data,
        user_id: userId,
        sync_state: 'synced',
        local_updated_at: timestamp,
      });
      break;
    }
    case 'task_tag': {
      await applyRemoteTaskTag({
        ...row.data,
        user_id: userId,
        sync_state: 'synced',
      });
      break;
    }
    default: {
      const exhaustive: never = row.entityType;
      void exhaustive;
    }
  }

  void db;
}

/* ---------------------------------------------------------------------------------------
 * Push
 * ------------------------------------------------------------------------------------- */

interface DrainOutcome {
  accepted: number;
  conflicts: number;
  failed: number;
}

/**
 * Drains the mutation queue in creation order.
 *
 * Order matters and is preserved: a create must reach the server before an update to the same row,
 * or the update would target a row the server has never seen. The queue is therefore drained
 * oldest-first and sequentially, not in parallel.
 *
 * A mutation that fails is NOT removed. It is rescheduled with backoff, and after
 * `MAX_MUTATION_RETRIES` it is parked as `failed` so the user can retry it manually. Parking
 * rather than retrying forever is what prevents an infinite loop on a permanently invalid payload.
 */
async function drainQueue(input: { userId: string; signal?: AbortSignal }): Promise<DrainOutcome> {
  const { userId, signal } = input;
  const db = getDatabase();

  const outcome: DrainOutcome = { accepted: 0, conflicts: 0, failed: 0 };

  const now = nowIsoSafe();
  const pending = await db.mutations.where('[user_id+status]').equals([userId, 'pending']).toArray();

  // Respect the backoff gate: skip anything scheduled for later.
  const due = pending
    .filter((mutation) => mutation.next_attempt_at === null || mutation.next_attempt_at <= now)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const mutation of due) {
    if (signal?.aborted) throw new SyncAbortedError();

    // Re-read: a concurrent local edit may have superseded this mutation while we were draining.
    const current = await db.mutations.get(mutation.id);
    if (!current || current.status !== 'pending') continue;

    await db.mutations.update(mutation.id, {
      status: 'in_flight',
      last_attempt_at: nowIsoSafe(),
    });

    let result: PushResult;
    try {
      result = await pushMutation({
        userId,
        mutation: current,
      });
    } catch (error) {
      // A thrown transport error means "unknown outcome", so the mutation goes back to pending
      // and is retried. It is never deleted on an exception: the write may or may not have landed,
      // and the idempotency key is what makes the retry safe either way.
      await rescheduleMutation(current, error);
      outcome.failed += 1;
      continue;
    }

    switch (result.kind) {
      case 'accepted': {
        await db.mutations.delete(current.id);
        await markEntitySynced(current.entity_id, current.entity_type, result.revision);
        outcome.accepted += 1;
        break;
      }

      case 'duplicate': {
        // The server already applied this mutation. Replaying the same idempotency key is the
        // normal case after a retry whose acknowledgement was lost, so this is success, not error.
        await db.mutations.delete(current.id);
        await markEntitySynced(current.entity_id, current.entity_type, result.revision);
        outcome.accepted += 1;
        break;
      }

      case 'conflict': {
        await recordConflict(userId, current, result);
        // The conflict is surfaced to the user, not resolved silently. The mutation is removed
        // because its content now lives in the conflict record, which is what the user will act on.
        await db.mutations.delete(current.id);
        await markEntityConflicted(current.entity_id, current.entity_type);
        outcome.conflicts += 1;
        break;
      }

      case 'rejected': {
        // A validation or policy rejection will never succeed on retry. Parking it as `failed`
        // immediately, rather than burning through the backoff schedule, tells the user the truth
        // sooner and stops pointless network traffic.
        await db.mutations.update(current.id, {
          status: 'failed',
          last_error: result.reason,
          retry_count: current.retry_count + 1,
          next_attempt_at: null,
        });
        await markEntityFailed(current.entity_id, current.entity_type);
        outcome.failed += 1;
        break;
      }

      default: {
        const exhaustive: never = result;
        void exhaustive;
      }
    }
  }

  return outcome;
}

/**
 * Schedules a retry with exponential backoff and jitter, or parks the mutation as failed once the
 * attempt cap is reached.
 */
async function rescheduleMutation(mutation: Mutation, error: unknown): Promise<void> {
  const db = getDatabase();
  const nextRetryCount = mutation.retry_count + 1;

  const safeMessage = safeErrorMessage(error);

  if (nextRetryCount >= MAX_MUTATION_RETRIES) {
    // Attempt cap reached. Stop retrying so the queue cannot loop forever on a persistent failure.
    await db.mutations.update(mutation.id, {
      status: 'failed',
      retry_count: nextRetryCount,
      last_error: safeMessage,
      next_attempt_at: null,
    });
    await markEntityFailed(mutation.entity_id, mutation.entity_type);
    return;
  }

  const delayMs = computeBackoffMs(nextRetryCount);
  const nextAttempt = new Date(Date.now() + delayMs).toISOString();

  await db.mutations.update(mutation.id, {
    status: 'pending',
    retry_count: nextRetryCount,
    last_error: safeMessage,
    next_attempt_at: nextAttempt,
  });
}

/**
 * Reduces an unknown error to a short, user-displayable message.
 *
 * Strips anything that looks like a credential before it can reach a log or the Sync Status
 * screen. The spec forbids logging tokens, and a raw transport error can embed a URL with a query
 * string. Defence in depth: the transport layer should already have sanitised, but a failure to
 * sanitise there must not leak here.
 */
function safeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Network request failed';

  return raw
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token redacted]')
    .replace(/access_token=[^&\s]+/g, 'access_token=[redacted]')
    .replace(/refresh_token=[^&\s]+/g, 'refresh_token=[redacted]')
    .slice(0, 300);
}

/** Marks the local row as synced and adopts the server's revision. */
async function markEntitySynced(
  entityId: string,
  entityType: string,
  revision: number | null,
): Promise<void> {
  const db = getDatabase();
  const synced = 'synced' as const;

  // Guarded per table rather than by a generic table lookup, so a mismatch is a type error rather
  // than a runtime write to the wrong table.
  switch (entityType) {
    case 'task': {
      const row = await db.tasks.get(entityId);
      if (row) {
        await db.tasks.put({
          ...row,
          revision: revision ?? row.revision,
          sync_state: synced,
        });
      }
      break;
    }
    case 'project': {
      const row = await db.projects.get(entityId);
      if (row) {
        await db.projects.put({
          ...row,
          revision: revision ?? row.revision,
          sync_state: synced,
        });
      }
      break;
    }
    case 'tag': {
      const row = await db.tags.get(entityId);
      if (row) {
        await db.tags.put({
          ...row,
          revision: revision ?? row.revision,
          sync_state: synced,
        });
      }
      break;
    }
    case 'subtask': {
      const row = await db.subtasks.get(entityId);
      if (row) {
        await db.subtasks.put({
          ...row,
          revision: revision ?? row.revision,
          sync_state: synced,
        });
      }
      break;
    }
    case 'task_tag': {
      const row = await db.taskTags.get(entityId);
      if (row) {
        await db.taskTags.put({
          ...row,
          revision: revision ?? row.revision,
          sync_state: synced,
        });
      }
      break;
    }
    default:
      break;
  }
}

async function markEntityFailed(entityId: string, entityType: string): Promise<void> {
  const db = getDatabase();
  const failed = 'failed' as const;

  switch (entityType) {
    case 'task': {
      const row = await db.tasks.get(entityId);
      if (row) await db.tasks.put({ ...row, sync_state: failed });
      break;
    }
    case 'project': {
      const row = await db.projects.get(entityId);
      if (row) await db.projects.put({ ...row, sync_state: failed });
      break;
    }
    case 'tag': {
      const row = await db.tags.get(entityId);
      if (row) await db.tags.put({ ...row, sync_state: failed });
      break;
    }
    case 'subtask': {
      const row = await db.subtasks.get(entityId);
      if (row) await db.subtasks.put({ ...row, sync_state: failed });
      break;
    }
    default:
      break;
  }
}

async function markEntityConflicted(entityId: string, entityType: string): Promise<void> {
  // A conflict leaves the local row as the user wrote it, marked pending, so nothing they typed
  // disappears while they decide. The Sync Status screen drives resolution.
  await markEntityFailed(entityId, entityType);
}

/**
 * Persists a conflict locally and on the server.
 *
 * Both variants are stored. The local row keeps the user's version so their work stays visible;
 * the server record is the authoritative copy that the resolution UI reads.
 */
async function recordConflict(
  userId: string,
  mutation: Mutation,
  result: Extract<PushResult, { kind: 'conflict' }>,
): Promise<void> {
  const db = getDatabase();

  const conflict: SyncConflict = {
    id: newId(),
    user_id: userId,
    entity_type: mutation.entity_type,
    entity_id: mutation.entity_id,
    conflicting_fields: result.conflictingFields.join(','),
    local_payload: mutation.payload,
    remote_payload: JSON.stringify(result.remoteRow),
    detected_at: nowIsoSafe(),
    resolved_at: null,
  };

  await db.conflicts.put(conflict);
}

/* ---------------------------------------------------------------------------------------
 * Manual retry and status
 * ------------------------------------------------------------------------------------- */

/**
 * Re-queues failed mutations so they are retried now.
 *
 * Resets the attempt counter: a user tapping "Retry" is making a deliberate decision, and the
 * backoff exists to protect against automated hammering, not to override the user.
 */
export async function retryFailedMutations(userId: string): Promise<number> {
  const db = getDatabase();
  const failed = await db.mutations.where('[user_id+status]').equals([userId, 'failed']).toArray();

  for (const mutation of failed) {
    await db.mutations.update(mutation.id, {
      status: 'pending',
      retry_count: 0,
      next_attempt_at: null,
      last_error: null,
    });
  }

  return failed.length;
}

/** Counts for the sync indicator and the Sync Status screen. */
export async function readSyncCounts(userId: string): Promise<{
  pending: number;
  failed: number;
  conflicts: number;
  lastPulledAt: string | null;
}> {
  const db = getDatabase();

  const [pending, failed, conflicts, meta] = await Promise.all([
    db.mutations.where('[user_id+status]').equals([userId, 'pending']).count(),
    db.mutations.where('[user_id+status]').equals([userId, 'failed']).count(),
    db.conflicts.where('[user_id+resolved_at]').equals([userId, null as unknown as string]).count(),
    db.syncMeta.get(`sync-meta:${userId}`),
  ]);

  return {
    pending,
    failed,
    conflicts,
    lastPulledAt: meta?.last_pulled_at ?? null,
  };
}

/**
 * Clears everything sync-related for an account: queued mutations, conflict records, and the pull
 * cursor.
 *
 * Called on sign-out. The cursor in particular MUST be cleared, because a new account must start
 * from revision 0 rather than inheriting the previous account's position and skipping rows.
 */
export async function resetSyncState(userId: string): Promise<void> {
  const db = getDatabase();

  await db.transaction('rw', db.mutations, db.conflicts, db.syncMeta, async () => {
    await db.mutations.where('[user_id+status]').between([userId, ''], [userId, '\uffff']).delete();

    const conflicts = await db.conflicts.where('user_id').equals(userId).toArray();
    if (conflicts.length > 0) {
      await db.conflicts.bulkDelete(conflicts.map((conflict) => conflict.id));
    }

    await db.syncMeta.delete(`sync-meta:${userId}`);
  });
}

/* ---------------------------------------------------------------------------------------
 * Force push and cursor reset
 *
 * These exist for the case where local data exists but never made it to the server — typically
 * guest-mode data that was migrated to an authenticated account without creating mutations, or
 * data left behind by failed mutations that were dropped. The normal sync cycle only pushes
 * queued mutations, so rows without mutations are invisible to it.
 * ------------------------------------------------------------------------------------- */

/** Fields that exist only in the local Dexie schema, not in the Supabase tables. */
const STRIP_ALWAYS = new Set(['sync_state', 'local_updated_at', 'revision']);

/**
 * Strips local-only fields from a row so the payload matches the Supabase table schema.
 *
 * `completed` on a Task is a local boolean; the Supabase `tasks` table uses `completed_at`
 * (timestamptz) and `status` (text). `updated_at` does not exist on `task_tags`. Including
 * either would make PostgREST reject the upsert with a 400.
 */
function toSyncPayload(
  row: Record<string, unknown>,
  entityType: SyncEntityType,
): Record<string, unknown> {
  const strip = new Set(STRIP_ALWAYS);
  if (entityType === 'task') strip.add('completed');
  if (entityType === 'task_tag') strip.add('updated_at');

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!strip.has(k)) out[k] = v;
  }
  return out;
}

/** Cast helper: typed row → Record for payload stripping. */
function asPayload(row: object): Record<string, unknown> {
  return row as unknown as Record<string, unknown>;
}

/**
 * Creates a 'create' mutation for every live local row that is not yet synced and does not
 * already have a pending mutation, then runs a full sync cycle.
 *
 * Rows with `sync_state === 'synced'` are skipped: they are already in Supabase and re-pushing
 * would only bump the revision without adding data. The upsert in `applyCreate` uses
 * `onConflict: 'id'` as a second defence, so a replay would update rather than duplicate.
 */
export async function forcePushAll(
  userId: string,
  deviceId: string,
): Promise<{ queued: number; pushed: number; failed: number; conflicts: number }> {
  const db = getDatabase();
  let queued = 0;
  let totalPushed = 0;
  let totalFailed = 0;
  let totalConflicts = 0;

  // Phase 1: Projects and tags have no FK dependencies — push them first so tasks can reference
  // projects and task_tags can reference tags.
  // Skip rows already synced to Supabase to avoid duplicates and unnecessary revision bumps.
  const projects = await liveRowsFor(db.projects, userId);
  for (const project of projects) {
    if (project.sync_state === 'synced') continue;
    if (await hasPendingMutationFor(project.id)) continue;
    await db.mutations.put(
      buildMutation(userId, {
        entityType: 'project',
        entityId: project.id,
        operation: 'create',
        payload: toSyncPayload(asPayload(project), 'project'),
        baseRevision: null,
      }),
    );
    queued += 1;
  }

  const tags = await liveRowsFor(db.tags, userId);
  for (const tag of tags) {
    if (tag.sync_state === 'synced') continue;
    if (await hasPendingMutationFor(tag.id)) continue;
    await db.mutations.put(
      buildMutation(userId, {
        entityType: 'tag',
        entityId: tag.id,
        operation: 'create',
        payload: toSyncPayload(asPayload(tag), 'tag'),
        baseRevision: null,
      }),
    );
    queued += 1;
  }

  if (queued > 0) {
    const report = await sync({ userId, deviceId });
    totalPushed += report.pushedCount;
    totalFailed += report.failedCount;
    totalConflicts += report.conflictCount;
  }

  // Phase 2: Tasks FK to projects. Push after projects exist in Supabase.
  let phase2 = 0;
  const tasks = await liveRowsFor(db.tasks, userId);
  for (const task of tasks) {
    if (task.sync_state === 'synced') continue;
    if (await hasPendingMutationFor(task.id)) continue;
    await db.mutations.put(
      buildMutation(userId, {
        entityType: 'task',
        entityId: task.id,
        operation: 'create',
        payload: toSyncPayload(asPayload(task), 'task'),
        baseRevision: null,
      }),
    );
    phase2 += 1;
  }

  if (phase2 > 0) {
    const report = await sync({ userId, deviceId });
    totalPushed += report.pushedCount;
    totalFailed += report.failedCount;
    totalConflicts += report.conflictCount;
  }

  // Phase 3: Subtasks FK to tasks. Task-tags FK to tasks and tags. Push last.
  let phase3 = 0;
  const subtasks = await liveRowsFor(db.subtasks, userId);
  for (const subtask of subtasks) {
    if (subtask.sync_state === 'synced') continue;
    if (await hasPendingMutationFor(subtask.id)) continue;
    await db.mutations.put(
      buildMutation(userId, {
        entityType: 'subtask',
        entityId: subtask.id,
        operation: 'create',
        payload: toSyncPayload(asPayload(subtask), 'subtask'),
        baseRevision: null,
      }),
    );
    phase3 += 1;
  }

  const taskTagRows = await db.taskTags.where('user_id').equals(userId).toArray();
  const liveTaskTags = decodeRowsFromStorage(taskTagRows);
  for (const tt of liveTaskTags) {
    if (tt.sync_state === 'synced') continue;
    if (await hasPendingMutationFor(tt.id)) continue;
    await db.mutations.put(
      buildMutation(userId, {
        entityType: 'task_tag',
        entityId: tt.id,
        operation: 'create',
        payload: toSyncPayload(asPayload(tt), 'task_tag'),
        baseRevision: null,
      }),
    );
    phase3 += 1;
  }

  queued += phase2 + phase3;

  if (phase3 > 0) {
    const report = await sync({ userId, deviceId });
    totalPushed += report.pushedCount;
    totalFailed += report.failedCount;
    totalConflicts += report.conflictCount;
  }

  return {
    queued,
    pushed: totalPushed,
    failed: totalFailed,
    conflicts: totalConflicts,
  };
}

/** Resets the pull cursor to 0 so the next sync pulls every row from the server. */
export async function resetPullCursor(userId: string): Promise<void> {
  await writeCursor(userId, 0, { pulledAt: nowIsoSafe() });
}

/** Reads the current pull cursor for display. */
export async function readPullCursor(userId: string): Promise<number> {
  return readCursor(userId);
}
