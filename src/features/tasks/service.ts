import {
  decodeRowFromStorage,
  encodeRowForStorage,
  getDatabase,
  liveChildRows,
  liveRowsFor,
  type LocalSubtask,
  type LocalTask,
  type LocalTaskTag,
} from '@/lib/db/schema';
import { nowIsoSafe, newId } from '@/lib/db/helpers';
import {
  buildMutation,
  supersedePendingMutations,
  writeTaskTagsWithMutations,
  writeTaskWithMutation,
} from '@/lib/db/repositories';
import {
  createTaskInputSchema,
  updateTaskInputSchema,
  formatZodErrors,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '@/lib/validation/schemas';
import { isOverdue as computeIsOverdue } from '@/lib/utils/date';
import type {
  Mutation,
  Priority,
  TaskFilters,
  TaskSort,
  TaskWithRelations,
  Tag,
} from '@/types/domain';

/**
 * Task domain service.
 *
 * Every mutation here writes to IndexedDB and enqueues an upload, synchronously from the user's
 * point of view. Nothing awaits the network. That is what makes the app work in a tunnel, and it
 * is why these functions never return a "sync succeeded" signal: they cannot know, and pretending
 * otherwise would be a lie the UI then renders.
 */

export class ValidationError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** Priority rank for sorting. Higher sorts first when direction is descending. */
const PRIORITY_RANK: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export interface TaskServiceContext {
  userId: string;
}

/**
 * Creates a task locally and queues it for upload.
 *
 * Returns the created row so the caller can open the detail panel immediately, which is the
 * interaction users expect from a quick-add.
 */
export async function createTask(
  ctx: TaskServiceContext,
  input: CreateTaskInput,
): Promise<LocalTask> {
  const parsed = createTaskInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(formatZodErrors(parsed.error));
  }

  const data = parsed.data;
  const timestamp = nowIsoSafe();
  const id = newId();

  const task: LocalTask = {
    id,
    user_id: ctx.userId,
    project_id: data.project_id,
    title: data.title,
    description: data.description,
    completed: false,
    priority: data.priority,
    due_date: data.due_date,
    start_date: data.start_date,
    reminder_at: data.reminder_at,
    completed_at: null,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    // New rows start at revision 0 with sync_state 'pending'. The server assigns the real
    // revision on acceptance; using 1 here would make the client claim a version it has not
    // been granted, which would then suppress the first conflict check.
    revision: 0,
    sync_state: 'pending',
    local_updated_at: timestamp,
  };

  const mutation = buildMutation(ctx.userId, {
    entityType: 'task',
    entityId: id,
    operation: 'create',
    payload: {
      id,
      title: task.title,
      description: task.description,
      project_id: task.project_id,
      priority: task.priority,
      due_date: task.due_date,
      start_date: task.start_date,
      reminder_at: task.reminder_at,
    },
    baseRevision: null,
  });

  await writeTaskWithMutation(task, mutation);

  if (data.tag_ids.length > 0) {
    await writeTaskTagsWithMutations(ctx.userId, id, data.tag_ids, []);
  }

  return task;
}

/**
 * Applies a partial update locally and queues it.
 *
 * The merged result is validated, not just the patch. `updateTaskInputSchema` cannot check
 * `start_date <= due_date` on a partial patch, because it does not know the row's other half, so
 * the cross-field check runs here against the merged row. Without this, a user could set a due
 * date earlier than an existing start date and only discover it when the server rejected the
 * upload, long after they moved on.
 */
export async function updateTask(
  ctx: TaskServiceContext,
  taskId: string,
  patch: UpdateTaskInput,
): Promise<LocalTask> {
  const db = getDatabase();
  const existing = await db.tasks.get(taskId);

  if (!existing) {
    throw new ValidationError({ _form: 'This task no longer exists.' });
  }

  // Ownership check. The local DB is per-device and shared between accounts, so a stale
  // reference from a previous account must not be writable.
  if (existing.user_id !== ctx.userId) {
    throw new ValidationError({ _form: 'This task no longer exists.' });
  }

  const parsed = updateTaskInputSchema.safeParse(patch);
  if (!parsed.success) {
    throw new ValidationError(formatZodErrors(parsed.error));
  }

  const data = parsed.data;
  const timestamp = nowIsoSafe();

  const nextStart = data.start_date === undefined ? existing.start_date : data.start_date;
  const nextDue = data.due_date === undefined ? existing.due_date : data.due_date;

  if (nextStart !== null && nextDue !== null && nextStart > nextDue) {
    throw new ValidationError({ start_date: 'Start date cannot be after the due date' });
  }

  // Completion timestamp consistency, mirroring the SQL CHECK constraint. Setting `completed`
  // without recording when would make the weekly-productivity figure invented rather than
  // measured, which the spec forbids.
  let nextCompletedAt = existing.completed_at;
  if (data.completed !== undefined && data.completed !== existing.completed) {
    nextCompletedAt = data.completed ? timestamp : null;
  }

  // Build the payload from only the keys the caller supplied, so an omitted field is not
  // uploaded as an explicit null (which would clobber a value set on another device).
  const payload: Record<string, unknown> = {};
  if (data.title !== undefined) payload.title = data.title;
  if (data.description !== undefined) payload.description = data.description;
  if (data.project_id !== undefined) payload.project_id = data.project_id;
  if (data.priority !== undefined) payload.priority = data.priority;
  if (data.due_date !== undefined) payload.due_date = data.due_date;
  if (data.start_date !== undefined) payload.start_date = data.start_date;
  if (data.reminder_at !== undefined) payload.reminder_at = data.reminder_at;
  if (data.completed !== undefined) {
    payload.completed = data.completed;
    payload.completed_at = nextCompletedAt;
  }

  const updated: LocalTask = {
    ...existing,
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.project_id !== undefined ? { project_id: data.project_id } : {}),
    ...(data.priority !== undefined ? { priority: data.priority } : {}),
    ...(data.due_date !== undefined ? { due_date: data.due_date } : {}),
    ...(data.start_date !== undefined ? { start_date: data.start_date } : {}),
    ...(data.reminder_at !== undefined ? { reminder_at: data.reminder_at } : {}),
    ...(data.completed !== undefined
      ? { completed: data.completed, completed_at: nextCompletedAt }
      : {}),
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
    // The base revision is the server revision this edit was based on. It is unchanged by the
    // local write because the row has not been re-accepted yet; the sync engine reads it when
    // building the upload payload.
  };

  // Collapse superseded pending updates so a burst of typing uploads once, not once per keystroke.
  await supersedePendingMutations(taskId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'task',
    entityId: taskId,
    operation: 'update',
    payload,
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeTaskWithMutation(updated, mutation);

  if (data.tag_ids !== undefined) {
    // Live links only. Passing tombstones would make the diff treat a re-added tag as still
    // present, so the tag would never come back.
    const currentLinks = await liveChildRows(db.taskTags, 'task_id', taskId);
    await writeTaskTagsWithMutations(ctx.userId, taskId, data.tag_ids, currentLinks);
  }

  return updated;
}

/** Convenience for the checkbox. Routes through `updateTask` so timestamp rules apply once. */
export async function setTaskCompleted(
  ctx: TaskServiceContext,
  taskId: string,
  completed: boolean,
): Promise<LocalTask> {
  return updateTask(ctx, taskId, { completed });
}

/**
 * Soft-deletes a task.
 *
 * Sets `deleted_at` rather than removing the row. A hard delete would be invisible to another
 * device that is offline, which would then re-upload the row and resurrect it. See
 * ARCHITECTURE.md §2.6.
 */
export async function deleteTask(ctx: TaskServiceContext, taskId: string): Promise<void> {
  const db = getDatabase();
  const existing = await db.tasks.get(taskId);

  if (!existing || existing.user_id !== ctx.userId) {
    // Deleting an already-deleted or foreign row is a no-op, not an error: the user's intent is
    // satisfied, and raising would surface a confusing message for a double-tap.
    return;
  }

  const timestamp = nowIsoSafe();

  const tombstoned: LocalTask = {
    ...existing,
    deleted_at: timestamp,
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
  };

  await supersedePendingMutations(taskId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'task',
    entityId: taskId,
    operation: 'delete',
    payload: { id: taskId, deleted_at: timestamp },
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeTaskWithMutation(tombstoned, mutation);

  // Subtasks are tombstoned alongside their parent so a device pulling later does not receive
  // orphaned checklist items for a task it no longer has.
  const subtasks = await liveChildRows(db.subtasks, 'task_id', taskId);
  for (const subtask of subtasks) {
    if (subtask.deleted_at) continue;

    const subtaskTombstone = {
      ...subtask,
      deleted_at: timestamp,
      updated_at: timestamp,
      local_updated_at: timestamp,
      sync_state: 'pending' as const,
    };

    const subtaskMutation = buildMutation(ctx.userId, {
      entityType: 'subtask',
      entityId: subtask.id,
      operation: 'delete',
      payload: { id: subtask.id, deleted_at: timestamp },
      baseRevision: subtask.revision > 0 ? subtask.revision : null,
    });

    await writeTaskWithMutationFallback(subtaskTombstone, subtaskMutation);
  }

  // Tag links are tombstoned with their parent task. The server also cascades on a hard delete of
  // the task, but the link rows are still alive on the server until that delete lands, so a second
  // device syncing in the window before it would otherwise pull the links back for a task it no
  // longer has. Tombstoning here closes that window.
  await tombstoneTagLinksForTask(ctx.userId, taskId, timestamp);
}

/** Soft-deletes every live tag link of a task, queuing one delete mutation per link. */
async function tombstoneTagLinksForTask(
  userId: string,
  taskId: string,
  timestamp: string,
): Promise<void> {
  const db = getDatabase();
  const links = await liveChildRows(db.taskTags, 'task_id', taskId);

  if (links.length === 0) return;

  await db.transaction('rw', db.taskTags, db.mutations, async () => {
    for (const link of links) {
      await db.taskTags.put(
        encodeRowForStorage({
          ...link,
          deleted_at: timestamp,
          updated_at: timestamp,
          sync_state: 'pending',
        }),
      );

      await db.mutations.add(
        buildMutation(userId, {
          entityType: 'task_tag',
          entityId: link.id,
          operation: 'delete',
          payload: { id: link.id, deleted_at: timestamp },
          baseRevision: link.revision > 0 ? link.revision : null,
        }),
      );
    }
  });
}

/**
 * Writes a subtask tombstone and its mutation.
 *
 * Separate from `writeTaskWithMutation` because the entity is a subtask, not a task. Named
 * explicitly rather than reusing a generic helper so the table pair is obvious at the call site
 * and a future refactor cannot silently point it at the wrong table.
 */
async function writeTaskWithMutationFallback(
  subtask: LocalSubtask,
  mutation: Mutation,
): Promise<void> {
  const db = getDatabase();
  await db.transaction('rw', db.subtasks, db.mutations, async () => {
    await db.subtasks.put(subtask);
    await db.mutations.add(mutation);
  });
}

/**
 * Bulk-deletes a set of tasks.
 *
 * Runs sequentially in one transaction per task rather than in parallel, because parallel Dexie
 * transactions on the same tables contend and can throw TransactionInactiveError. For a
 * realistic bulk selection (tens of tasks) this is fast and predictable.
 */
export async function bulkDeleteTasks(
  ctx: TaskServiceContext,
  taskIds: readonly string[],
): Promise<number> {
  let deleted = 0;
  for (const taskId of taskIds) {
    await deleteTask(ctx, taskId);
    deleted += 1;
  }
  return deleted;
}

/** Completes or reopens many tasks at once, for the bulk action bar. */
export async function bulkSetCompleted(
  ctx: TaskServiceContext,
  taskIds: readonly string[],
  completed: boolean,
): Promise<number> {
  let updated = 0;
  for (const taskId of taskIds) {
    await setTaskCompleted(ctx, taskId, completed);
    updated += 1;
  }
  return updated;
}

/**
 * Reads live tasks for an account, joined with the display data a row needs.
 *
 * Filtering and sorting are done in memory rather than in IndexedDB. That is a deliberate
 * choice: the filter set includes a free-text search across two fields and combinations that
 * cannot be expressed as a compound index, and a single-user task list is small enough
 * (thousands at most) that an in-memory pass is faster than the index selection it would take
 * to express the same predicate. If a user ever exceeds six figures of tasks, this is the
 * function to revisit first.
 */
export async function listTasks(
  ctx: TaskServiceContext,
  filters: TaskFilters,
  sort: TaskSort,
): Promise<TaskWithRelations[]> {
  const db = getDatabase();

  const [tasks, projects, tags, taskTags, subtasks] = await Promise.all([
    liveRowsFor(db.tasks, ctx.userId),
    liveRowsFor(db.projects, ctx.userId),
    liveRowsFor(db.tags, ctx.userId),
    liveRowsFor(db.taskTags, ctx.userId),
    liveRowsFor(db.subtasks, ctx.userId),
  ]);

  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));

  // Precompute per-task tag and subtask aggregates so the join is one pass, not N lookups per
  // row. Building this lazily inside the map would be O(tasks x links).
  const tagsByTask = new Map<string, Tag[]>();
  for (const link of taskTags) {
    const tag = tagById.get(link.tag_id);
    if (!tag) continue;
    const list = tagsByTask.get(link.task_id);
    if (list) {
      list.push(tag);
    } else {
      tagsByTask.set(link.task_id, [tag]);
    }
  }

  const subtaskCounts = new Map<string, { total: number; completed: number }>();
  for (const subtask of subtasks) {
    const entry = subtaskCounts.get(subtask.task_id) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (subtask.completed) entry.completed += 1;
    subtaskCounts.set(subtask.task_id, entry);
  }

  const withRelations: TaskWithRelations[] = tasks.map((task) => {
    const project = task.project_id ? projectById.get(task.project_id) : undefined;
    const counts = subtaskCounts.get(task.id) ?? { total: 0, completed: 0 };

    return {
      ...task,
      project: project ? { id: project.id, name: project.name, color: project.color } : null,
      tags: tagsByTask.get(task.id) ?? [],
      subtaskCount: counts.total,
      subtaskCompletedCount: counts.completed,
    };
  });

  const filtered = applyFilters(withRelations, filters);
  return sortTasks(filtered, sort);
}

/** Predicate set. Kept pure and exported so it can be unit-tested without a database. */
export function applyFilters(
  tasks: readonly TaskWithRelations[],
  filters: TaskFilters,
): TaskWithRelations[] {
  const searchTerm = filters.search.trim().toLowerCase();
  const prioritySet = new Set(filters.priorities);
  const projectSet = new Set(filters.projectIds);
  const tagSet = new Set(filters.tagIds);

  return tasks.filter((task) => {
    if (filters.completion === 'active' && task.completed) return false;
    if (filters.completion === 'completed' && !task.completed) return false;

    if (prioritySet.size > 0 && !prioritySet.has(task.priority)) return false;

    // A task with no project is included when the filter is empty, but excluded from a
    // project-specific filter unless it belongs to one of the selected projects.
    if (projectSet.size > 0) {
      if (!task.project_id || !projectSet.has(task.project_id)) return false;
    }

    if (tagSet.size > 0) {
      const hasMatchingTag = task.tags.some((tag) => tagSet.has(tag.id));
      if (!hasMatchingTag) return false;
    }

    if (filters.dueFrom !== null) {
      if (!task.due_date || task.due_date < filters.dueFrom) return false;
    }

    if (filters.dueTo !== null) {
      if (!task.due_date || task.due_date > filters.dueTo) return false;
    }

    if (filters.overdueOnly && !computeIsOverdue(task.due_date, task.completed)) return false;

    if (filters.dueTodayOnly) {
      const today = new Date();
      const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate(),
      ).padStart(2, '0')}`;
      if (task.due_date !== localToday) return false;
    }

    if (searchTerm.length > 0) {
      const inTitle = task.title.toLowerCase().includes(searchTerm);
      const inDescription = task.description?.toLowerCase().includes(searchTerm) ?? false;
      if (!inTitle && !inDescription) return false;
    }

    return true;
  });
}

/**
 * Sort comparator.
 *
 * Null due dates always sink to the bottom regardless of direction. That is intentional: a task
 * with no deadline is not "due infinitely far in the future", and flipping the sort should not
 * scatter undated tasks into the middle of a dated list, which is disorienting.
 */
export function sortTasks(tasks: readonly TaskWithRelations[], sort: TaskSort): TaskWithRelations[] {
  const direction = sort.direction === 'asc' ? 1 : -1;

  return [...tasks].sort((a, b) => {
    // Completed tasks always sort after active ones, so the list does not interleave them.
    if (a.completed !== b.completed) return a.completed ? 1 : -1;

    let comparison = 0;

    switch (sort.field) {
      case 'due_date': {
        if (a.due_date === null && b.due_date === null) comparison = 0;
        else if (a.due_date === null) return 1;
        else if (b.due_date === null) return -1;
        else comparison = a.due_date.localeCompare(b.due_date);
        break;
      }
      case 'priority': {
        comparison = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        break;
      }
      case 'created_at': {
        comparison = a.created_at.localeCompare(b.created_at);
        break;
      }
      case 'title': {
        // Locale-aware so accented titles sort as a reader expects rather than by code point.
        comparison = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        break;
      }
      default: {
        const exhaustive: never = sort.field;
        void exhaustive;
        comparison = 0;
      }
    }

    if (comparison !== 0) return comparison * direction;

    // Stable tiebreak on id so the order does not shift between renders when two rows compare
    // equal, which would make list keys jump.
    return a.id.localeCompare(b.id);
  });
}

/** Loads one task with relations, for the detail panel. */
export async function getTask(
  ctx: TaskServiceContext,
  taskId: string,
): Promise<TaskWithRelations | null> {
  const db = getDatabase();
  const task = await db.tasks.get(taskId);

  // Stored rows encode a live `deleted_at` as the empty string, so `Task`'s domain shape has to be
  // restored before these comparisons mean anything.
  if (!task) return null;
  const decoded = decodeRowFromStorage(task);
  if (decoded.user_id !== ctx.userId || decoded.deleted_at !== null) return null;

  const [project, links, liveSubtasks] = await Promise.all([
    decoded.project_id ? db.projects.get(decoded.project_id) : Promise.resolve(undefined),
    liveChildRows(db.taskTags, 'task_id', taskId),
    liveChildRows(db.subtasks, 'task_id', taskId),
  ]);

  const liveProject = project ? decodeRowFromStorage(project) : undefined;

  // Tag rows are read directly rather than through a helper because each is identified by an id
  // from the link table, so a per-link decode is the honest shape here.
  const tagRows = await Promise.all(links.map((link) => db.tags.get(link.tag_id)));
  const tags = tagRows
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
    .map((tag) => decodeRowFromStorage(tag))
    .filter((tag) => tag.deleted_at === null);

  return {
    ...decoded,
    project: liveProject
      ? { id: liveProject.id, name: liveProject.name, color: liveProject.color }
      : null,
    tags,
    subtaskCount: liveSubtasks.length,
    subtaskCompletedCount: liveSubtasks.filter((subtask) => subtask.completed).length,
  };
}

/** Live tag links for a task, used by the tag editor to compute its diff. */
export async function getTaskTagLinks(taskId: string): Promise<LocalTaskTag[]> {
  const db = getDatabase();
  return liveChildRows(db.taskTags, 'task_id', taskId);
}
