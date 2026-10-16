/**
 * Core domain types for Todowork.
 *
 * These are the shapes shared by the Dexie store, the sync engine, and Supabase. The
 * Supabase schema in `supabase/migrations/` is the authoritative definition; these types
 * mirror it. Local rows additionally carry sync bookkeeping that never leaves the device
 * (see `LocalMeta`), which is why local and remote shapes are related but not identical.
 */

/** Priority is a closed set of three levels (spec §5G). Never extend without a migration. */
export type Priority = 'low' | 'medium' | 'high';

export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'] as const;

/**
 * A task as stored on the server and mirrored locally.
 *
 * Timestamps are ISO-8601 strings in UTC for storage. Dates that represent a *day*
 * (`due_date`, `start_date`) are stored as `YYYY-MM-DD` calendar dates with no time or zone,
 * because a task due "on the 14th" is due on the 14th regardless of where the user is when
 * they look at it. Converting those to instants is the classic source of off-by-one date
 * bugs, so the type system keeps them as date-only strings.
 */
export interface Task {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  completed: boolean;
  priority: Priority;
  /** Calendar date, `YYYY-MM-DD`, or null. Not an instant. */
  due_date: string | null;
  /** Calendar date, `YYYY-MM-DD`, or null. Not an instant. */
  start_date: string | null;
  /** Instant (ISO-8601 UTC) when the task was completed, or null. */
  completed_at: string | null;
  /** Instant (ISO-8601 UTC) when soft-deleted, or null. Tombstone marker. */
  deleted_at: string | null;
  /** Instant (ISO-8601 UTC) the reminder should fire, or null. */
  reminder_at: string | null;
  created_at: string;
  updated_at: string;
  /** Server-owned monotonic version. Incremented by trigger on every accepted write. */
  revision: number;
}

/** A project groups tasks. Tasks may be unparented, hence `project_id: string | null`. */
export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  /** Hex colour used by the "work rail" motif. Constrained to a known palette by validation. */
  color: string;
  /** Instant when archived, or null. Archived projects are hidden from pickers, not deleted. */
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

/**
 * Subtask / checklist item.
 *
 * `position` is a float so a reorder can be written as a single row update (midpoint between
 * neighbours) instead of renumbering the whole list, which would generate one mutation per
 * sibling and amplify badly on a flaky connection.
 */
export interface Subtask {
  id: string;
  task_id: string;
  user_id: string;
  title: string;
  completed: boolean;
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

/** Join row between tasks and tags. Ids are client-generated, like every other entity. */
export interface TaskTag {
  id: string;
  task_id: string;
  tag_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  /** Soft-delete tombstone, so untagging propagates to other devices instead of the link returning. */
  deleted_at: string | null;
  revision: number;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

/* ---------------------------------------------------------------------------------------
 * Sync engine types
 * ------------------------------------------------------------------------------------- */

export type SyncEntityType = 'task' | 'project' | 'tag' | 'subtask' | 'task_tag';

export type MutationOperation = 'create' | 'update' | 'delete';

export type MutationStatus = 'pending' | 'in_flight' | 'failed' | 'conflict';

/**
 * A queued local write awaiting upload.
 *
 * This table is the durability backbone of offline mode: it is written in the *same Dexie
 * transaction* as the entity change, so a mutation can never be lost by a tab closing
 * between "wrote the row" and "queued the upload". If those were separate transactions, a
 * crash in between would leave a local edit that never syncs, silently.
 */
export interface Mutation {
  id: string;
  /** Unique per logical intent. The server rejects replays via a unique constraint. */
  idempotency_key: string;
  user_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  operation: MutationOperation;
  /** Serialised field changes. Never contains tokens or credentials. */
  payload: string;
  /** Revision the client believed was current when it made the edit. */
  base_revision: number | null;
  created_at: string;
  last_attempt_at: string | null;
  retry_count: number;
  status: MutationStatus;
  /** Safe, user-displayable failure reason. Never a raw stack trace or token. */
  last_error: string | null;
  /** Instant before which this mutation must not be retried. Backoff gate. */
  next_attempt_at: string | null;
}

export interface SyncConflict {
  id: string;
  user_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  /** The field names that were edited on both sides to different values. */
  conflicting_fields: string;
  /** Serialised local variant at conflict time. */
  local_payload: string;
  /** Serialised server variant at conflict time. */
  remote_payload: string;
  detected_at: string;
  resolved_at: string | null;
}

/** Per-device sync bookkeeping. One row per account, local only, never synced. */
export interface SyncMeta {
  key: string;
  user_id: string | null;
  /** Highest server revision this device has successfully pulled. */
  last_pulled_revision: number;
  /** Server time of the last successful pull, for diagnostics. */
  last_pulled_at: string | null;
  last_push_at: string | null;
  /**
   * Which device last advanced this account's cursor.
   *
   * Recorded so that Settings > Sync can tell the user which of their devices wrote the cursor, and
   * so a cursor that looks wrong can be traced to the device that produced it. It is diagnostic
   * only: the cursor itself, not the device, is what the pull loop trusts.
   */
  last_device_id: string | null;
}

/** Derived, never persisted: what the sync indicator renders. */
export type SyncPhase =
  | 'idle'
  | 'offline'
  | 'syncing'
  | 'pending'
  | 'error'
  | 'conflict';

export interface SyncStatus {
  phase: SyncPhase;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  /** Present when phase is 'error'; already sanitised for display. */
  message?: string;
}

/**
 * Per-row sync bookkeeping, stored only in IndexedDB.
 *
 * Declared here rather than in the db layer so that view types such as `TaskWithRelations` can
 * describe it without domain code depending on the database module. The db module imports this,
 * which keeps the dependency direction one-way: domain → nothing, db → domain.
 *
 *   - `synced`  : this row has no unsynced local change
 *   - `pending` : a local change is queued and not yet confirmed by the server
 *   - `failed`  : a queued change was rejected or exhausted its retries and needs attention
 */
export type LocalSyncState = 'synced' | 'pending' | 'failed';

/* ---------------------------------------------------------------------------------------
 * View / query types
 * ------------------------------------------------------------------------------------- */

export type SortField = 'due_date' | 'priority' | 'created_at' | 'title';
export type SortDirection = 'asc' | 'desc';

export type CompletionFilter = 'all' | 'active' | 'completed';

export interface TaskFilters {
  search: string;
  completion: CompletionFilter;
  priorities: Priority[];
  projectIds: string[];
  tagIds: string[];
  /** Inclusive calendar-date bounds, `YYYY-MM-DD`. */
  dueFrom: string | null;
  dueTo: string | null;
  /** Convenience predicates that cannot be expressed as plain field equality. */
  overdueOnly: boolean;
  dueTodayOnly: boolean;
}

export interface TaskSort {
  field: SortField;
  direction: SortDirection;
}

/**
 * A task joined with the display data its row needs, so the list does not do N lookups.
 *
 * `sync_state` is included because the list renders a per-row sync marker. It is a local-only field
 * (see `LocalSyncState`), which is why it is declared here rather than on the wire `Task` type.
 */
export interface TaskWithRelations extends Task {
  project: Pick<Project, 'id' | 'name' | 'color'> | null;
  tags: Tag[];
  subtaskCount: number;
  subtaskCompletedCount: number;
  sync_state: LocalSyncState;
}

export interface DashboardStats {
  activeTotal: number;
  completedTotal: number;
  dueToday: number;
  overdue: number;
  upcoming: number;
  /** 0-100. Null when there is nothing to compute a rate from, so the UI can show "—". */
  completionRate: number | null;
  completedThisWeek: number;
  completedLastWeek: number;
  projects: ProjectProgress[];
  recentActivity: ActivityEntry[];
}

export interface ProjectProgress {
  project: Pick<Project, 'id' | 'name' | 'color'>;
  total: number;
  completed: number;
  /** 0-100. Null when the project has no tasks, so the UI shows an empty state. */
  percentage: number | null;
}

export interface ActivityEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  kind: 'created' | 'completed' | 'updated';
  at: string;
}

export interface SyncReport {
  pulledCount: number;
  pushedCount: number;
  conflictCount: number;
  failedCount: number;
  durationMs: number;
}
