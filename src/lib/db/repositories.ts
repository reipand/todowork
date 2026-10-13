import { type Table } from 'dexie';

import {
  encodeRowForStorage,
  getDatabase,
  type LocalProject,
  type LocalSubtask,
  type LocalTag,
  type LocalTask,
  type LocalTaskTag,
} from '@/lib/db/schema';
import { newId, newIdempotencyKey, nowIsoSafe } from '@/lib/db/helpers';
import type { Mutation, MutationOperation, SyncEntityType } from '@/types/domain';

/**
 * Write path for local data.
 *
 * The invariant this module exists to uphold:
 *
 *   An entity change and its queued mutation are written in the SAME transaction.
 *
 * If those were two separate transactions, a tab closing, a crash, or a mobile OS suspending the
 * WebView between them would leave a local edit that never syncs. The user would see their task,
 * believe it saved, and silently lose it on the next device. That is the failure mode this
 * module is built to make impossible, so every write below goes through a single `db.transaction`.
 *
 * Reads do not go through here: components read reactively via `useLiveQuery`, which Dexie
 * serves from IndexedDB directly.
 */

export interface MutationEnqueue {
  entityType: SyncEntityType;
  entityId: string;
  operation: MutationOperation;
  /** Only the changed fields, so a retry re-applies the same minimal patch. */
  payload: Record<string, unknown>;
  baseRevision: number | null;
}

/**
 * Builds a mutation row. Does not write it; the caller includes it in its transaction so the
 * entity change and the queue entry commit or roll back together.
 */
export function buildMutation(userId: string, input: MutationEnqueue): Mutation {
  return {
    id: newId(),
    idempotency_key: newIdempotencyKey(),
    user_id: userId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    operation: input.operation,
    // Serialised at enqueue time so a later in-memory change to the source object cannot
    // retroactively alter what gets uploaded. The queue must be immutable once written.
    payload: JSON.stringify(input.payload),
    base_revision: input.baseRevision,
    created_at: nowIsoSafe(),
    last_attempt_at: null,
    retry_count: 0,
    status: 'pending',
    last_error: null,
    next_attempt_at: null,
  };
}

/**
 * Writes a task and enqueues its mutation atomically.
 *
 * Used for create, update, and soft delete: all three are "write the row, queue the upload".
 * Keeping them in one function means there is exactly one place where the transaction boundary
 * is defined, rather than three places that could drift.
 */
export async function writeTaskWithMutation(
  task: LocalTask,
  mutation: Mutation,
): Promise<void> {
  const db = getDatabase();

  await db.transaction('rw', db.tasks, db.mutations, async () => {
    await db.tasks.put(encodeRowForStorage(task));
    await db.mutations.add(mutation);
  });
}

/** Writes a project and enqueues its mutation atomically. */
export async function writeProjectWithMutation(
  project: LocalProject,
  mutation: Mutation,
): Promise<void> {
  const db = getDatabase();

  await db.transaction('rw', db.projects, db.mutations, async () => {
    await db.projects.put(encodeRowForStorage(project));
    await db.mutations.add(mutation);
  });
}

/** Writes a tag and enqueues its mutation atomically. */
export async function writeTagWithMutation(tag: LocalTag, mutation: Mutation): Promise<void> {
  const db = getDatabase();

  await db.transaction('rw', db.tags, db.mutations, async () => {
    await db.tags.put(encodeRowForStorage(tag));
    await db.mutations.add(mutation);
  });
}

/** Writes a subtask and enqueues its mutation atomically. */
export async function writeSubtaskWithMutation(
  subtask: LocalSubtask,
  mutation: Mutation,
): Promise<void> {
  const db = getDatabase();

  await db.transaction('rw', db.subtasks, db.mutations, async () => {
    await db.subtasks.put(encodeRowForStorage(subtask));
    await db.mutations.add(mutation);
  });
}

/**
 * Replaces a task's tag set and enqueues the needed join-table mutations, atomically.
 *
 * Diffing rather than delete-all-then-insert-all matters: a full replace would enqueue a
 * mutation for every tag on every save, so editing a task's title would also re-upload five
 * unrelated tag links. On a metered mobile connection that is real cost, and it makes the queue
 * harder to reason about during conflict resolution.
 */
export async function writeTaskTagsWithMutations(
  userId: string,
  taskId: string,
  nextTagIds: readonly string[],
  currentLinks: readonly LocalTaskTag[],
): Promise<void> {
  const db = getDatabase();
  const currentTagIds = new Set(currentLinks.map((link) => link.tag_id));
  const nextTagIdSet = new Set(nextTagIds);

  const toAdd = nextTagIds.filter((tagId) => !currentTagIds.has(tagId));
  const toRemove = currentLinks.filter((link) => !nextTagIdSet.has(link.tag_id));

  if (toAdd.length === 0 && toRemove.length === 0) return;

  await db.transaction('rw', db.taskTags, db.mutations, async () => {
    for (const tagId of toAdd) {
      const timestamp = nowIsoSafe();
      const link: LocalTaskTag = {
        id: newId(),
        task_id: taskId,
        tag_id: tagId,
        user_id: userId,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        revision: 0,
        sync_state: 'pending',
      };
      await db.taskTags.put(encodeRowForStorage(link));

      await db.mutations.add(
        buildMutation(userId, {
          entityType: 'task_tag',
          entityId: link.id,
          operation: 'create',
          payload: {
            id: link.id,
            task_id: taskId,
            tag_id: tagId,
            created_at: timestamp,
            updated_at: timestamp,
          },
          baseRevision: null,
        }),
      );
    }

    for (const link of toRemove) {
      const timestamp = nowIsoSafe();

      // Soft delete, not a hard delete. A hard local delete would leave nothing for the pull phase
      // to reconcile against, so a second device would still hold the link and would push it back.
      // The tombstone travels through the same revision cursor as every other change.
      await db.taskTags.put(
        encodeRowForStorage({ ...link, deleted_at: timestamp, updated_at: timestamp, sync_state: 'pending' }),
      );

      await db.mutations.add(
        buildMutation(userId, {
          entityType: 'task_tag',
          entityId: link.id,
          operation: 'delete',
          payload: { id: link.id, deleted_at: timestamp },
          // A tombstone is itself a revisioned update, so it carries the base revision and can be
          // detected as a conflict if the other device edited the same link.
          baseRevision: link.revision,
        }),
      );
    }
  });
}

/**
 * Applies a server-originated row to the local store during a pull, without enqueuing anything.
 *
 * Pulled rows must never create a mutation. If they did, every download would generate an
 * upload, and two devices would ping-pong changes forever.
 *
 * The local `sync_state` is set to 'synced' only if the row has no pending local mutation.
 * Overwriting a row that the user edited offline would discard their work, so the caller checks
 * for pending mutations first (see `hasPendingMutationFor`).
 */
export async function applyRemoteTask(task: LocalTask): Promise<void> {
  const db = getDatabase();
  await db.tasks.put(encodeRowForStorage(task));
}

export async function applyRemoteProject(project: LocalProject): Promise<void> {
  const db = getDatabase();
  await db.projects.put(encodeRowForStorage(project));
}

export async function applyRemoteTag(tag: LocalTag): Promise<void> {
  const db = getDatabase();
  await db.tags.put(encodeRowForStorage(tag));
}

export async function applyRemoteSubtask(subtask: LocalSubtask): Promise<void> {
  const db = getDatabase();
  await db.subtasks.put(encodeRowForStorage(subtask));
}

export async function applyRemoteTaskTag(link: LocalTaskTag): Promise<void> {
  const db = getDatabase();
  await db.taskTags.put(link);
}

/** True when the account has an unsynced mutation touching this entity. */
export async function hasPendingMutationFor(entityId: string): Promise<boolean> {
  const db = getDatabase();
  const count = await db.mutations
    .where('entity_id')
    .equals(entityId)
    .filter((mutation) => mutation.status === 'pending' || mutation.status === 'in_flight')
    .count();

  return count > 0;
}

/**
 * Drops a mutation that has been superseded.
 *
 * Used when a newer local edit to the same entity replaces an older queued one. Without this,
 * a user who types a title then corrects it before reconnecting uploads both versions in order,
 * which works but wastes a round-trip and briefly makes the server state wrong.
 *
 * Only supersedes pending rows. An in-flight row may already have been applied server-side and
 * must not be discarded, or its idempotency record would never be reconciled.
 */
export async function supersedePendingMutations(
  entityId: string,
  operations: readonly MutationOperation[],
): Promise<void> {
  const db = getDatabase();

  await db.transaction('rw', db.mutations, async () => {
    const candidates = await db.mutations.where('entity_id').equals(entityId).toArray();

    for (const mutation of candidates) {
      if (mutation.status !== 'pending') continue;
      if (!operations.includes(mutation.operation)) continue;
      await db.mutations.delete(mutation.id);
    }
  });
}

/** Removes every queued mutation for an account. Called when signing out with pending work. */
export async function discardAllMutations(userId: string): Promise<number> {
  const db = getDatabase();
  return db.mutations.where('[user_id+status]').between([userId, ''], [userId, '\uffff']).delete();
}

/** Pending and in-flight mutation count, for the sync indicator. */
export async function countUnsyncedMutations(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.mutations
    .where('[user_id+status]')
    .anyOf([
      [userId, 'pending'],
      [userId, 'in_flight'],
    ])
    .count();

  return rows;
}

/**
 * Table accessor helper, kept here so the sync engine and the repositories agree on which
 * Dexie table backs each entity type. A mismatch here would silently write to the wrong table,
 * so it is centralised.
 */
export function tableForEntity(
  entityType: SyncEntityType,
): Table<{ id: string }, string> | null {
  const db = getDatabase();

  switch (entityType) {
    case 'task':
      return db.tasks as unknown as Table<{ id: string }, string>;
    case 'project':
      return db.projects as unknown as Table<{ id: string }, string>;
    case 'tag':
      return db.tags as unknown as Table<{ id: string }, string>;
    case 'subtask':
      return db.subtasks as unknown as Table<{ id: string }, string>;
    case 'task_tag':
      return db.taskTags as unknown as Table<{ id: string }, string>;
    default: {
      // Exhaustiveness guard: adding an entity type without handling it here is a compile error.
      const exhaustive: never = entityType;
      void exhaustive;
      return null;
    }
  }
}
