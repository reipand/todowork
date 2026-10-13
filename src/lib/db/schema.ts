import Dexie, { type Table } from 'dexie';

import type {
  LocalSyncState,
  Mutation,
  Project,
  Subtask,
  SyncConflict,
  SyncMeta,
  Tag,
  Task,
  TaskTag,
} from '@/types/domain';

/**
 * Todowork local database.
 *
 * This is the UI's source of truth. Every screen renders from here, never directly from the
 * network. That is what makes offline a property of the architecture instead of a feature
 * bolted on, and it is why a task created in a tunnel appears instantly.
 *
 * Local rows carry two extra fields that never sync:
 *   - `sync_state`: whether the row has unsynced local changes, so the row can show a marker
 *   - `local_updated_at`: device clock, used only for conflict *diagnostics*, never for
 *     resolution (device clocks are not trustworthy; see ARCHITECTURE.md §2.4)
 *
 * Indexing strategy. Dexie indexes are declared in the `stores` string. A compound index like
 * `[user_id+deleted_at]` exists because every live query filters on both, and without the
 * compound index IndexedDB would scan. Getting these wrong is the usual cause of a slow task
 * list, so each index is annotated with the query it serves.
 */

/** Per-row sync bookkeeping. Mirrors the `sync_status` field required by spec §5B. */
export type { LocalSyncState } from '@/types/domain';

export interface LocalTask extends Task {
  sync_state: LocalSyncState;
  local_updated_at: string;
}

export interface LocalProject extends Project {
  sync_state: LocalSyncState;
  local_updated_at: string;
}

export interface LocalTag extends Tag {
  sync_state: LocalSyncState;
  local_updated_at: string;
}

export interface LocalSubtask extends Subtask {
  sync_state: LocalSyncState;
  local_updated_at: string;
}

export interface LocalTaskTag extends TaskTag {
  sync_state: LocalSyncState;
}

export class TodoworkDatabase extends Dexie {
  tasks!: Table<LocalTask, string>;
  projects!: Table<LocalProject, string>;
  tags!: Table<LocalTag, string>;
  subtasks!: Table<LocalSubtask, string>;
  taskTags!: Table<LocalTaskTag, string>;

  /** Durable mutation queue. Written in the same transaction as the entity change. */
  mutations!: Table<Mutation, string>;

  /** Local mirror of server-side conflict records, for the resolution UI. */
  conflicts!: Table<SyncConflict, string>;

  /** Per-account sync cursor. Local only, never uploaded. */
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super('todowork');

    this.version(1).stores({
      // Compound [user_id+deleted_at] serves the "live tasks for this user" query, which is
      // the most frequent read in the app. The trailing fields let IndexedDB satisfy the
      // sort without a second pass in most cases.
      tasks: 'id, [user_id+deleted_at], [user_id+completed], [user_id+due_date], [user_id+project_id], [user_id+revision], sync_state, user_id',

      projects: 'id, [user_id+deleted_at], [user_id+archived_at], [user_id+revision], sync_state, user_id',

      tags: 'id, [user_id+deleted_at], [user_id+revision], &[user_id+name], sync_state, user_id',

      // `[user_id+deleted_at]` is present on these two as well, because the task list joins every
      // live subtask and tag link for the account in one pass and would otherwise fall back to a
      // full table scan with an in-memory filter.
      subtasks:
        'id, [task_id+deleted_at], [task_id+position], [user_id+deleted_at], [user_id+revision], sync_state, task_id, user_id',

      taskTags:
        'id, [task_id+tag_id], [task_id+deleted_at], [user_id+deleted_at], [user_id+revision], sync_state, task_id, tag_id, user_id',

      // The queue is drained in creation order, hence the created_at index. The status index
      // serves "how many are pending", which the sync indicator shows on every screen.
      mutations: 'id, &idempotency_key, [status+next_attempt_at], [user_id+status], entity_id, created_at',

      conflicts: 'id, [user_id+resolved_at], entity_id, detected_at',

      // Single row per account, keyed deterministically so a read never scans.
      syncMeta: 'key, user_id',
    });
  }
}

let database: TodoworkDatabase | null = null;

/**
 * Returns the shared database instance.
 *
 * Memoised because opening a second connection to the same IndexedDB database from the same
 * tab causes Dexie to log a warning and, worse, two instances can hold divergent in-memory
 * state. One instance per tab, always.
 */
export function getDatabase(): TodoworkDatabase {
  if (!database) {
    database = new TodoworkDatabase();
  }
  return database;
}

/**
 * Deletes the entire local database. Only ever called from an explicit, confirmed user action
 * (account deletion, or "remove local data" in Settings), never automatically.
 *
 * The spec requires that no local data is deleted silently, so this function's only caller is
 * a UI flow that has already shown a confirmation dialog.
 */
export async function destroyLocalDatabase(): Promise<void> {
  if (database) {
    database.close();
    database = null;
  }
  await Dexie.delete('todowork');
}

/**
 * Builds the deterministic sync-meta key for an account.
 *
 * Guest mode uses a reserved id so a guest's local data is namespaced separately and can never
 * be confused with a real account's data or uploaded to it.
 */
export const GUEST_USER_ID = 'guest-local';

export function syncMetaKey(userId: string | null): string {
  return `sync-meta:${userId ?? GUEST_USER_ID}`;
}

/**
 * Migrates all local rows from `GUEST_USER_ID` to a real auth user id.
 *
 * This runs once when a user who created data in guest mode signs in. Without it, those rows keep
 * `user_id = 'guest-local'` forever: the sync engine never picks them up (it queries by the auth
 * user id), and even if it did, the RLS INSERT policy on `tasks` checks that the referenced
 * project belongs to `auth.uid()` — a project created in guest mode has the wrong user_id, so
 * the policy denies the upsert with 403.
 *
 * The migration is a single Dexie transaction across every user-scoped table. `syncMeta` is
 * excluded: the guest cursor is cleared separately by `resetSyncState` in the session context.
 */
export async function migrateGuestData(newUserId: string): Promise<{
  migrated: boolean;
  total: number;
}> {
  const db = getDatabase();

  // All Dexie tables that carry a user_id column and need migration.
  const tableNames = [
    'tasks',
    'projects',
    'tags',
    'subtasks',
    'taskTags',
    'mutations',
    'conflicts',
  ] as const;

  let total = 0;

  await db.transaction('rw', tableNames, async () => {
    for (const name of tableNames) {
      // db.table(name) returns a loosely-typed Table, avoiding the union-type
      // incompatibility across the strongly-typed table properties on the class.
      const table = db.table(name);
      const rows = await table.where('user_id').equals(GUEST_USER_ID).toArray();
      if (rows.length > 0) {
        await table.bulkPut(rows.map((row: Record<string, unknown>) => ({ ...row, user_id: newUserId })));
      }
      total += rows.length;
    }
  });

  return { migrated: total > 0, total };
}

/* ---------------------------------------------------------------------------------------
 * Live-row query helpers
 * ------------------------------------------------------------------------------------- */

/**
 * The value used to key the `[user_id+deleted_at]` compound index for a live (non-deleted) row.
 *
 * IndexedDB cannot index `null` as part of a compound key, so the local schema stores an empty
 * string in the `deleted_at` slot for live rows and the real ISO timestamp for tombstones. This
 * constant and `tombstoneKey` are the only two places that conversion is expressed; every query in
 * the app goes through `liveRowsFor` instead of building the key itself.
 *
 * Getting this wrong is a silent bug rather than a loud one: the index simply matches nothing and
 * the task list renders as empty. That is the reason the conversion lives in one file with a
 * comment rather than being open-coded at each call site.
 */
export const LIVE_TOMBSTONE_KEY = '';

/**
 * Encodes a domain row for storage by replacing a `null` `deleted_at` with the empty-string key.
 *
 * Every local write goes through {@link encodeRowForStorage}. The domain keeps `deleted_at: null`
 * because that is what the SQL column means and what the sync payload must carry; only the
 * IndexedDB copy is rewritten.
 */
export function encodeRowForStorage<T extends { deleted_at?: string | null }>(
  row: T,
): T {
  if (row.deleted_at === null || row.deleted_at === undefined) {
    return { ...row, deleted_at: LIVE_TOMBSTONE_KEY };
  }
  return row;
}

/**
 * Decodes a stored row back into the domain shape, restoring `''` to `null`.
 *
 * Without this, a live task loaded from IndexedDB would carry `deleted_at: ''`, and any code
 * doing `task.deleted_at !== null` would wrongly treat a live task as deleted.
 */
export function decodeRowFromStorage<T extends { deleted_at?: string | null }>(
  row: T,
): T {
  if (row.deleted_at === LIVE_TOMBSTONE_KEY) {
    return { ...row, deleted_at: null };
  }
  return row;
}

/** Encodes a list of rows for storage. */
export function encodeRowsForStorage<T extends { deleted_at?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => encodeRowForStorage(row));
}

/** Decodes a list of stored rows back into domain shapes. */
export function decodeRowsFromStorage<T extends { deleted_at?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.map((row) => decodeRowFromStorage(row));
}

/** Minimal shape of a soft-deletable, user-scoped row: Dexie only needs the two key fields. */
interface SoftDeletableUserRow {
  user_id: string;
  deleted_at: string | null;
}

/**
 * Typed equivalent of `table.where('[user_id+deleted_at]').equals([userId, null])`.
 *
 * Dexie's generated key types do not accept `null` in a compound key, and they are right not to:
 * the index does not contain `null` for live rows, it contains the empty string (see
 * `encodeRowForStorage`). This helper keeps the intent ("live rows for this account") readable and
 * pushes the key encoding into the one place that also owns the write-side encoding.
 *
 * The returned rows are decoded, so callers always see `deleted_at: null` for live rows.
 */
export async function liveRowsFor<T extends SoftDeletableUserRow>(
  table: Table<T, string>,
  userId: string,
): Promise<T[]> {
  const rows = await table
    .where('[user_id+deleted_at]')
    .equals([userId, LIVE_TOMBSTONE_KEY] as never)
    .toArray();

  return decodeRowsFromStorage(rows);
}

/** Live rows of a parent-scoped table, for example the subtasks of one task. */
export async function liveChildRows<T extends { deleted_at: string | null }>(
  table: Table<T, string>,
  parentField: string,
  parentId: string,
): Promise<T[]> {
  const rows = await table
    .where(`[${parentField}+deleted_at]`)
    .equals([parentId, LIVE_TOMBSTONE_KEY] as never)
    .toArray();

  return decodeRowsFromStorage(rows);
}

/**
 * All rows of a parent-scoped table, tombstones included, decoded.
 *
 * Used where the caller genuinely needs to see tombstones: the sync engine reconciling a pull, and
 * the tag-link diff, which must distinguish "already removed" from "never linked".
 */
export async function allChildRows<T extends { deleted_at: string | null }>(
  table: Table<T, string>,
  parentField: string,
  parentId: string,
): Promise<T[]> {
  const rows = await table.where(parentField).equals(parentId).toArray();
  return decodeRowsFromStorage(rows);
}
