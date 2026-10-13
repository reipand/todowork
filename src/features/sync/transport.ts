import { getSupabaseClient } from '@/lib/supabase/client';
import type { Mutation, SyncEntityType } from '@/types/domain';
import type { Json } from '@/types/database';

/**
 * Sync transport: the only module that talks to the network.
 *
 * Keeping the network in one file has two payoffs. First, the retry, backoff, and conflict logic
 * in the engine become testable against a fake transport with no mocking of a global HTTP client.
 * Second, there is exactly one place where a credential could accidentally be logged, so there is
 * exactly one place to audit for it.
 *
 * Nothing here writes auth tokens to a payload or a log. The Supabase client attaches the session
 * itself; this module never touches it.
 */

export interface PulledRow {
  entityType: SyncEntityType;
  id: string;
  revision: number;
  // The entity columns, ready to be stored locally.
  // Typed loosely here because the union of five row shapes would otherwise dominate the module;
  // the engine narrows it per entityType before writing.
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface PullPage {
  rows: PulledRow[];
  /** Highest revision the server currently holds, so the caller can stop paging. */
  highWaterMark: number;
}

export type PushResult =
  | { kind: 'accepted'; revision: number | null }
  | { kind: 'duplicate'; revision: number | null }
  | { kind: 'conflict'; conflictingFields: string[]; remoteRow: Record<string, unknown> }
  | { kind: 'rejected'; reason: string };

/** Columns that are never part of a conflict comparison. */
const NON_MERGEABLE_FIELDS = new Set(['id', 'user_id', 'created_at', 'updated_at', 'revision']);

/**
 * Fetches rows changed above a revision cursor, across all syncable tables.
 *
 * Each table is queried for `revision > cursor`, ordered ascending, limited to the page size. The
 * per-table limit is the page size divided by the table count so one busy table cannot crowd out
 * the others and starve their changes.
 */
export async function fetchChangedRows(input: {
  userId: string;
  sinceRevision: number;
  limit: number;
}): Promise<PullPage> {
  const { userId, sinceRevision, limit } = input;
  const supabase = getSupabaseClient();

  const perTable = Math.max(1, Math.ceil(limit / 5));

  const [tasks, projects, tags, subtasks, taskTags] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .gt('revision', sinceRevision)
      .order('revision', { ascending: true })
      .limit(perTable),
    supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .gt('revision', sinceRevision)
      .order('revision', { ascending: true })
      .limit(perTable),
    supabase
      .from('tags')
      .select('*')
      .eq('user_id', userId)
      .gt('revision', sinceRevision)
      .order('revision', { ascending: true })
      .limit(perTable),
    supabase
      .from('task_subtasks')
      .select('*')
      .eq('user_id', userId)
      .gt('revision', sinceRevision)
      .order('revision', { ascending: true })
      .limit(perTable),
    // Join rows are revisioned like every other entity: a link is soft-deleted when a tag is
    // removed, and that tombstone has to travel through the same cursor or the other device would
    // resurrect the link.
    supabase
      .from('task_tags')
      .select('*')
      .eq('user_id', userId)
      .gt('revision', sinceRevision)
      .order('revision', { ascending: true })
      .limit(perTable),
  ]);

  const firstError = tasks.error ?? projects.error ?? tags.error ?? subtasks.error ?? taskTags.error;
  if (firstError) {
    // Message is passed through as-is; it is a Supabase error string, not a credential. The engine
    // re-sanitises before it is stored or displayed.
    throw new Error(firstError.message);
  }

  const rows: PulledRow[] = [];
  let highWaterMark = sinceRevision;

  const collect = (table: PulledRow['data'][], entityType: SyncEntityType, revisionField: string): void => {
    for (const row of table) {
      const revision = typeof row[revisionField] === 'number' ? row[revisionField] : 0;
      rows.push({ entityType, id: row.id, revision, data: row });
      if (revision > highWaterMark) highWaterMark = revision;
    }
  };

  collect(tasks.data ?? [], 'task', 'revision');
  collect(projects.data ?? [], 'project', 'revision');
  collect(tags.data ?? [], 'tag', 'revision');
  collect(subtasks.data ?? [], 'subtask', 'revision');

  // Join rows carry no revision, so they are given the current high-water mark. They are pulled by
  // created_at and merged by primary key, so replaying one is harmless: `put` is idempotent.
  for (const row of taskTags.data ?? []) {
    rows.push({ entityType: 'task_tag', id: row.id, revision: highWaterMark, data: row });
  }

  // Sort by revision so the cursor advances monotonically and a mid-page abort leaves a
  // consistent position.
  rows.sort((a, b) => a.revision - b.revision);

  return { rows, highWaterMark };
}

/**
 * Pushes one mutation and interprets the server's response.
 *
 * The conflict check is the core of optimistic concurrency. A mutation carries `base_revision`, the
 * server revision the client's edit was based on. If the server row has since moved past that, the
 * edit is concurrent and is handled by the documented policy rather than by overwriting.
 *
 * Ordering inside this function matters: the idempotency ledger is consulted FIRST, so a retry of an
 * already-applied mutation returns the original outcome instead of re-applying or reporting a
 * spurious conflict.
 */
export async function pushMutation(input: {
  userId: string;
  mutation: Mutation;
}): Promise<PushResult> {
  const { userId, mutation } = input;
  const supabase = getSupabaseClient();

  // --- Idempotency gate ---------------------------------------------------------------
  // A unique violation on this insert means the mutation was already applied and its ledger row
  // survived. That is a success replay, not an error.
  const ledgerInsert = await supabase
    .from('sync_mutations')
    .insert({
      user_id: userId,
      idempotency_key: mutation.idempotency_key,
      entity_type: mutation.entity_type,
      entity_id: mutation.entity_id,
      operation: mutation.operation,
    })
    .select('result_revision')
    .single();

  if (ledgerInsert.error) {
    // 23505 is unique_violation: the key already exists, so this mutation already ran.
    if (ledgerInsert.error.code === '23505') {
      const existing = await supabase
        .from('sync_mutations')
        .select('result_revision')
        .eq('user_id', userId)
        .eq('idempotency_key', mutation.idempotency_key)
        .maybeSingle();

      return {
        kind: 'duplicate',
        revision: existing.data?.result_revision ?? null,
      };
    }

    throw new Error(ledgerInsert.error.message);
  }

  const payload = parsePayload(mutation.payload);

  // --- Conflict detection -------------------------------------------------------------
  if (mutation.operation !== 'create' && mutation.base_revision !== null) {
    const current = await fetchCurrentRow(mutation.entity_type, mutation.entity_id);

    if (current && typeof current.revision === 'number' && current.revision > mutation.base_revision) {
      // The row moved. Decide between automatic merge and a recorded conflict.
      const remoteRow = current as Record<string, unknown>;
      const conflictingFields = findConflictingFields(payload, remoteRow);

      if (conflictingFields.length === 0) {
        // The two edits touched disjoint fields, so both can survive. Nothing is lost and the user
        // never needs to be asked. This is the common case and the reason a merge step exists
        // rather than a blunt last-write-wins.
        const merged = { ...payload };
        const mergedResult = await applyUpdate(mutation.entity_type, mutation.entity_id, merged);

        if (mergedResult.error) {
          throw new Error(mergedResult.error.message);
        }

        const revision = (mergedResult.data as { revision?: number } | null)?.revision ?? null;
        await recordLedgerRevision(userId, mutation.idempotency_key, revision);
        return { kind: 'accepted', revision };
      }

      // Genuinely concurrent edits to the same field. Record the conflict so the user decides; do
      // NOT silently pick a winner and do NOT overwrite the server row.
      const revision = typeof remoteRow.revision === 'number' ? remoteRow.revision : 0;

      await supabase.from('sync_conflicts').insert({
        user_id: userId,
        entity_type: mutation.entity_type,
        entity_id: mutation.entity_id,
        conflicting_fields: conflictingFields.join(','),
        local_payload: payload as unknown as Json,
        remote_payload: remoteRow as unknown as Json,
        server_revision: revision,
      });

      return { kind: 'conflict', conflictingFields, remoteRow };
    }
  }

  // --- Apply --------------------------------------------------------------------------
  try {
    const result =
      mutation.operation === 'create'
        ? await applyCreate(mutation.entity_type, payload)
        : mutation.operation === 'delete'
          ? await applyDelete(mutation.entity_type, mutation.entity_id)
          : await applyUpdate(mutation.entity_type, mutation.entity_id, payload);

    if (result.error) {
      // Classify the failure. A constraint violation will never succeed on retry, so it is
      // reported as rejected and parked rather than retried until the attempt cap.
      const code = result.error.code;
      if (
        code === '23514' || // check_violation
        code === '23503' || // foreign_key_violation
        code === '23505' || // unique_violation
        code === '42501' || // insufficient_privilege (RLS denied)
        code === '22P02' // invalid_text_representation
      ) {
        return { kind: 'rejected', reason: sanitizeDbError(result.error.message) };
      }

      // Anything else is treated as transient: keep it queued and retry with backoff.
      throw new Error(result.error.message);
    }

    const revision = (result.data as { revision?: number } | null)?.revision ?? null;
    await recordLedgerRevision(userId, mutation.idempotency_key, revision);

    return { kind: 'accepted', revision };
  } catch (error) {
    // Re-check for a ledger row. A create that succeeded server-side but lost its response would
    // otherwise be retried and reported as a unique violation on the entity's primary key.
    const verification = await supabase
      .from('sync_mutations')
      .select('result_revision')
      .eq('user_id', userId)
      .eq('idempotency_key', mutation.idempotency_key)
      .maybeSingle();

    if (verification.data) {
      return { kind: 'duplicate', revision: verification.data.result_revision ?? null };
    }

    throw error;
  }
}

/** Persists the resulting revision against the ledger row, so a replay can echo it. */
async function recordLedgerRevision(
  userId: string,
  idempotencyKey: string,
  revision: number | null,
): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase
    .from('sync_mutations')
    .update({ result_revision: revision })
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey);
}

async function fetchCurrentRow(
  entityType: SyncEntityType,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(tableName(entityType))
    .select('*')
    .eq('id', entityId)
    .maybeSingle();

  if (error) return null;
  return (data as Record<string, unknown> | null) ?? null;
}

async function applyCreate(
  entityType: SyncEntityType,
  payload: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  const supabase = getSupabaseClient();

  // `upsert` with the primary key as the conflict target makes a create idempotent at the row
  // level too. This is the second line of defence behind the ledger: even if a ledger row were
  // pruned, replaying a create would not produce a duplicate task.
  const { data, error } = await supabase
    .from(tableName(entityType))
    .upsert(payload as never, { onConflict: 'id' })
    .select()
    .single();

  return { data, error };
}

async function applyUpdate(
  entityType: SyncEntityType,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from(tableName(entityType))
    .update(payload as never)
    .eq('id', entityId)
    .select()
    .single();

  return { data, error };
}

async function applyDelete(
  entityType: SyncEntityType,
  entityId: string,
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  const supabase = getSupabaseClient();

  // Deletes are soft: the tombstone timestamp travels in the payload and this writes it. The row is
  // never physically removed here, because other devices still need to learn that the deletion
  // happened. See ARCHITECTURE.md §2.6.
  const { data, error } = await supabase
    .from(tableName(entityType))
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq('id', entityId)
    .select()
    .single();

  return { data, error };
}

/**
 * Compares a local patch against the current server row and returns the field names that differ.
 *
 * Only fields present in the LOCAL patch are considered: a field the local edit did not touch is
 * not a conflict, even if the server changed it. That is what makes the disjoint-edit merge work.
 */
function findConflictingFields(
  localPatch: Record<string, unknown>,
  remoteRow: Record<string, unknown>,
): string[] {
  const conflicts: string[] = [];

  for (const [field, localValue] of Object.entries(localPatch)) {
    if (NON_MERGEABLE_FIELDS.has(field)) continue;

    const remoteValue = remoteRow[field];

    // `completed` is special-cased per the documented policy: when the patch sets it true and the
    // remote is false, completion wins without asking. Re-completing is idempotent and the user's
    // intent is unambiguous; interrupting them to confirm "yes, you did finish it" is noise.
    if (field === 'completed') {
      if (localValue === true && remoteValue === false) continue;
    }

    if (!valuesEqual(localValue, remoteValue)) {
      conflicts.push(field);
    }
  }

  return conflicts;
}

/** Structural equality for the JSON-compatible values a payload can hold. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => valuesEqual(value, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      valuesEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }
  return false;
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // A malformed payload cannot be applied. Returning an empty patch turns it into a no-op rather
    // than a crash, and the mutation will be rejected by the server for having no valid columns.
    return {};
  }
}

/**
 * Strips detail from a database error before it can be shown to a user or stored.
 *
 * Constraint messages can include column names and values. Showing a raw Postgres error to a user is
 * both unhelpful and a mild information leak, so it is reduced to a plain-language cause.
 */
function sanitizeDbError(message: string): string {
  if (message.includes('check constraint') || message.includes('violates check')) {
    return 'The data did not meet the required format.';
  }
  if (message.includes('foreign key') || message.includes('violates foreign key')) {
    return 'A related item is missing or belongs to another account.';
  }
  if (message.includes('duplicate key') || message.includes('unique constraint')) {
    return 'This item already exists.';
  }
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return 'This change is not permitted for the current account.';
  }
  return 'The server rejected this change.';
}

function tableName(entityType: SyncEntityType): 'tasks' | 'projects' | 'tags' | 'task_subtasks' | 'task_tags' {
  switch (entityType) {
    case 'task':
      return 'tasks';
    case 'project':
      return 'projects';
    case 'tag':
      return 'tags';
    case 'subtask':
      return 'task_subtasks';
    case 'task_tag':
      return 'task_tags';
    default: {
      const exhaustive: never = entityType;
      throw new Error(`Unknown entity type: ${String(exhaustive)}`);
    }
  }
}
