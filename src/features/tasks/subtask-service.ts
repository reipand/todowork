import {
  allChildRows,
  decodeRowFromStorage,
  getDatabase,
  liveChildRows,
  type LocalSubtask,
} from '@/lib/db/schema';
import { nowIsoSafe, newId } from '@/lib/db/helpers';
import { buildMutation, supersedePendingMutations, writeSubtaskWithMutation } from '@/lib/db/repositories';
import {
  createSubtaskInputSchema,
  updateSubtaskInputSchema,
  formatZodErrors,
  type CreateSubtaskInput,
  type UpdateSubtaskInput,
} from '@/lib/validation/schemas';
import { ValidationError, type TaskServiceContext } from '@/features/tasks/service';

/**
 * Subtask (checklist) service.
 *
 * Ordering uses midpoint insertion: a reorder between two items writes the numeric midpoint of
 * their positions, so it is a single-row update. The alternative (renumbering the whole list) would
 * emit one mutation per sibling, so reordering a 20-item checklist offline would queue 20 uploads.
 *
 * Positions are doubles precisely to support this. Repeated midpoint insertion does eventually
 * exhaust float precision, so `appendSubtask` spaces new items by 1000 and the service falls back
 * to a full renormalise when two neighbours become indistinguishable.
 */

/** Spacing between appended items, large enough to allow many midpoints before precision runs out. */
const POSITION_STEP = 1000;

export async function createSubtask(
  ctx: TaskServiceContext,
  input: CreateSubtaskInput,
): Promise<LocalSubtask> {
  const parsed = createSubtaskInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(formatZodErrors(parsed.error));
  }

  const data = parsed.data;
  const db = getDatabase();

  // The parent task must exist and belong to this account. Without this check a stale id from a
  // previous account could attach a checklist item to a task the user can no longer see.
  // The row is decoded because IndexedDB stores live `deleted_at` as '' not null.
  const rawParent = await db.tasks.get(data.task_id);
  const parent = rawParent ? decodeRowFromStorage(rawParent) : null;
  if (!parent || parent.user_id !== ctx.userId || parent.deleted_at !== null) {
    throw new ValidationError({ _form: 'This task no longer exists.' });
  }

  const existing = await allChildRows(db.subtasks, 'task_id', data.task_id);
  const liveSiblings = existing.filter((subtask) => subtask.deleted_at === null);
  const maxPosition =
    liveSiblings.length === 0
      ? 0
      : Math.max(...liveSiblings.map((subtask) => subtask.position));

  const id = newId();
  const timestamp = nowIsoSafe();

  const subtask: LocalSubtask = {
    id,
    task_id: data.task_id,
    user_id: ctx.userId,
    title: data.title,
    completed: false,
    position: maxPosition + POSITION_STEP,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    revision: 0,
    sync_state: 'pending',
    local_updated_at: timestamp,
  };

  const mutation = buildMutation(ctx.userId, {
    entityType: 'subtask',
    entityId: id,
    operation: 'create',
    payload: {
      id,
      task_id: subtask.task_id,
      title: subtask.title,
      position: subtask.position,
    },
    baseRevision: null,
  });

  await writeSubtaskWithMutation(subtask, mutation);
  return subtask;
}

export async function updateSubtask(
  ctx: TaskServiceContext,
  subtaskId: string,
  patch: UpdateSubtaskInput,
): Promise<LocalSubtask> {
  const parsed = updateSubtaskInputSchema.safeParse(patch);
  if (!parsed.success) {
    throw new ValidationError(formatZodErrors(parsed.error));
  }

  const data = parsed.data;
  const db = getDatabase();
  const existing = await db.subtasks.get(subtaskId);

  if (!existing || existing.user_id !== ctx.userId) {
    throw new ValidationError({ _form: 'This checklist item no longer exists.' });
  }

  const timestamp = nowIsoSafe();
  const payload: Record<string, unknown> = {};
  if (data.title !== undefined) payload.title = data.title;
  if (data.completed !== undefined) payload.completed = data.completed;
  if (data.position !== undefined) payload.position = data.position;

  const updated: LocalSubtask = {
    ...existing,
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.completed !== undefined ? { completed: data.completed } : {}),
    ...(data.position !== undefined ? { position: data.position } : {}),
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
  };

  await supersedePendingMutations(subtaskId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'subtask',
    entityId: subtaskId,
    operation: 'update',
    payload,
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeSubtaskWithMutation(updated, mutation);
  return updated;
}

export async function deleteSubtask(ctx: TaskServiceContext, subtaskId: string): Promise<void> {
  const db = getDatabase();
  const existing = await db.subtasks.get(subtaskId);

  if (!existing || existing.user_id !== ctx.userId) return;

  const timestamp = nowIsoSafe();

  const tombstoned: LocalSubtask = {
    ...existing,
    deleted_at: timestamp,
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
  };

  await supersedePendingMutations(subtaskId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'subtask',
    entityId: subtaskId,
    operation: 'delete',
    payload: { id: subtaskId, deleted_at: timestamp },
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeSubtaskWithMutation(tombstoned, mutation);
}

export async function listSubtasks(
  ctx: TaskServiceContext,
  taskId: string,
): Promise<LocalSubtask[]> {
  const db = getDatabase();
  const subtasks = await liveChildRows(db.subtasks, 'task_id', taskId);

  return subtasks
    .filter((subtask) => subtask.user_id === ctx.userId)
    .sort((a, b) => a.position - b.position);
}

/**
 * Moves a subtask to sit between two neighbours, using midpoint positions.
 *
 * Passing `null` for a neighbour means "at that end of the list". Returns the updated row so the
 * caller can render without a re-read.
 *
 * When the midpoint is no longer representable (the two neighbours have converged to adjacent
 * doubles), the whole list is renormalised instead. That is the rare fallback path, and it is
 * bounded: renormalising is a handful of writes, not an unbounded loop.
 */
export async function reorderSubtask(
  ctx: TaskServiceContext,
  taskId: string,
  subtaskId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<LocalSubtask | null> {
  const subtasks = await listSubtasks(ctx, taskId);
  const moving = subtasks.find((subtask) => subtask.id === subtaskId);
  if (!moving) return null;

  const before = beforeId ? subtasks.find((subtask) => subtask.id === beforeId) : null;
  const after = afterId ? subtasks.find((subtask) => subtask.id === afterId) : null;

  let nextPosition: number;

  if (before && after) {
    nextPosition = (before.position + after.position) / 2;

    // Precision exhausted: both neighbours now map to the same double. Renormalise the list so
    // positions are distinct again, then recompute this item's target.
    if (nextPosition === before.position || nextPosition === after.position) {
      await renormalisePositions(ctx, taskId);
      return reorderSubtask(ctx, taskId, subtaskId, beforeId, afterId);
    }
  } else if (before) {
    nextPosition = before.position + POSITION_STEP;
  } else if (after) {
    nextPosition = after.position / 2;
    // Guard the low end: half of a tiny value can underflow toward zero. If it would, renormalise.
    if (nextPosition === 0 || nextPosition === after.position) {
      await renormalisePositions(ctx, taskId);
      return reorderSubtask(ctx, taskId, subtaskId, beforeId, afterId);
    }
  } else {
    nextPosition = POSITION_STEP;
  }

  return updateSubtask(ctx, subtaskId, { position: nextPosition });
}

/**
 * Rewrites positions for every live subtask of a task using even spacing.
 *
 * Called only from `reorderSubtask` when midpoints are no longer representable. Each row is
 * written through the normal update path so the changes sync like any other edit.
 */
async function renormalisePositions(ctx: TaskServiceContext, taskId: string): Promise<void> {
  const subtasks = await listSubtasks(ctx, taskId);

  for (let index = 0; index < subtasks.length; index += 1) {
    const subtask = subtasks[index];
    if (!subtask) continue;

    const target = (index + 1) * POSITION_STEP;
    if (subtask.position !== target) {
      await updateSubtask(ctx, subtask.id, { position: target });
    }
  }
}
