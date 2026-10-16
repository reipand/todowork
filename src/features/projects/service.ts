import {
  decodeRowFromStorage,
  getDatabase,
  liveRowsFor,
  type LocalProject,
} from '@/lib/db/schema';
import { nowIsoSafe, newId } from '@/lib/db/helpers';
import { buildMutation, supersedePendingMutations, writeProjectWithMutation, writeTaskWithMutation } from '@/lib/db/repositories';
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  formatZodErrors,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@/lib/validation/schemas';
import { ValidationError, deleteTask, type TaskServiceContext } from '@/features/tasks/service';
import type { ProjectProgress } from '@/types/domain';

/**
 * Project domain service.
 *
 * Projects are a flat grouping (no nesting), which keeps the task list's project picker a single
 * level and avoids the query complexity a tree would add for little user benefit at this scale.
 */

export async function createProject(
  ctx: TaskServiceContext,
  input: CreateProjectInput,
): Promise<LocalProject> {
  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(formatZodErrors(parsed.error));
  }

  const data = parsed.data;
  const db = getDatabase();
  const timestamp = nowIsoSafe();

  // Reject a duplicate live name. The server enforces uniqueness for tags but not projects, so
  // this check is client-side only. Two projects with the same name are confusing in the project
  // picker, where the name is the only visible differentiator alongside the colour.
  const liveProjects = await liveRowsFor(db.projects, ctx.userId);

  const nameTaken = liveProjects.some(
    (project) => project.name.trim().toLowerCase() === data.name.trim().toLowerCase(),
  );

  if (nameTaken) {
    throw new ValidationError({ name: 'A project with this name already exists' });
  }

  const id = newId();
  const project: LocalProject = {
    id,
    user_id: ctx.userId,
    name: data.name,
    description: data.description,
    color: data.color,
    archived_at: null,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    revision: 0,
    sync_state: 'pending',
    local_updated_at: timestamp,
  };

  const mutation = buildMutation(ctx.userId, {
    entityType: 'project',
    entityId: id,
    operation: 'create',
    payload: {
      id,
      name: project.name,
      description: project.description,
      color: project.color,
    },
    baseRevision: null,
  });

  await writeProjectWithMutation(project, mutation);
  return project;
}

export async function updateProject(
  ctx: TaskServiceContext,
  projectId: string,
  patch: UpdateProjectInput,
): Promise<LocalProject> {
  const parsed = updateProjectInputSchema.safeParse(patch);
  if (!parsed.success) {
    throw new ValidationError(formatZodErrors(parsed.error));
  }

  const data = parsed.data;
  const db = getDatabase();
  const existing = await db.projects.get(projectId);

  if (!existing || existing.user_id !== ctx.userId) {
    throw new ValidationError({ _form: 'This project no longer exists.' });
  }

  if (data.name !== undefined) {
    const liveProjects = await liveRowsFor(db.projects, ctx.userId);

    const nameTaken = liveProjects.some(
      (project) =>
        project.id !== projectId &&
        project.name.trim().toLowerCase() === data.name!.trim().toLowerCase(),
    );

    if (nameTaken) {
      throw new ValidationError({ name: 'A project with this name already exists' });
    }
  }

  const timestamp = nowIsoSafe();
  const payload: Record<string, unknown> = {};

  if (data.name !== undefined) payload.name = data.name;
  if (data.description !== undefined) payload.description = data.description;
  if (data.color !== undefined) payload.color = data.color;

  // Archiving toggles a timestamp rather than a boolean, so "archived" and "when" are the same
  // fact and cannot disagree.
  let nextArchivedAt = existing.archived_at;
  if (data.archived !== undefined) {
    const shouldArchive = data.archived;
    const currentlyArchived = existing.archived_at !== null;
    if (shouldArchive !== currentlyArchived) {
      nextArchivedAt = shouldArchive ? timestamp : null;
      payload.archived_at = nextArchivedAt;
    }
  }

  const updated: LocalProject = {
    ...existing,
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.color !== undefined ? { color: data.color } : {}),
    archived_at: nextArchivedAt,
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
  };

  await supersedePendingMutations(projectId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'project',
    entityId: projectId,
    operation: 'update',
    payload,
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeProjectWithMutation(updated, mutation);
  return updated;
}

/**
 * Deletes a project.
 *
 * `taskHandling` makes the relation policy explicit instead of guessing:
 *   - 'detach' (default): tasks survive and become unparented. Losing a whole project's tasks
 *     because the container was deleted is the more damaging mistake, so it is not the default.
 *   - 'delete-tasks': tasks are soft-deleted too, for a user who is discarding the whole effort.
 *
 * The spec requires explicit handling of task relations on project delete, which is why this is
 * a required parameter rather than a silent default inside the function.
 */
export async function deleteProject(
  ctx: TaskServiceContext,
  projectId: string,
  taskHandling: 'detach' | 'delete-tasks',
): Promise<{ detached: number; deleted: number }> {
  const db = getDatabase();
  const existing = await db.projects.get(projectId);

  if (!existing || existing.user_id !== ctx.userId) {
    return { detached: 0, deleted: 0 };
  }

  const timestamp = nowIsoSafe();
  const linkedTasks = await db.tasks
    .where('[user_id+project_id]')
    .equals([ctx.userId, projectId] as never)
    .toArray();
  const liveTasks = linkedTasks.map((task) => decodeRowFromStorage(task));

  if (taskHandling === 'delete-tasks') {
    for (const task of liveTasks) {
      await deleteTask(ctx, task.id);
    }
  } else {
    // Detach: clear project_id on each task and queue that change, so the tasks survive unparented
    // rather than becoming orphaned references to a tombstoned project.
    for (const task of liveTasks) {
      const detached = {
        ...task,
        project_id: null,
        updated_at: timestamp,
        local_updated_at: timestamp,
        sync_state: 'pending' as const,
      };

      const mutation = buildMutation(ctx.userId, {
        entityType: 'task',
        entityId: task.id,
        operation: 'update',
        payload: { project_id: null },
        baseRevision: task.revision > 0 ? task.revision : null,
      });

      await writeTaskWithMutation(detached, mutation);
    }
  }

  const tombstoned: LocalProject = {
    ...existing,
    deleted_at: timestamp,
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
  };

  await supersedePendingMutations(projectId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'project',
    entityId: projectId,
    operation: 'delete',
    payload: { id: projectId, deleted_at: timestamp },
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeProjectWithMutation(tombstoned, mutation);

  return {
    detached: taskHandling === 'detach' ? liveTasks.length : 0,
    deleted: taskHandling === 'delete-tasks' ? liveTasks.length : 0,
  };
}

export async function listProjects(
  ctx: TaskServiceContext,
  options: { includeArchived?: boolean } = {},
): Promise<LocalProject[]> {
  const db = getDatabase();
  const projects = await liveRowsFor(db.projects, ctx.userId);

  const filtered = options.includeArchived
    ? projects
    : projects.filter((project) => project.archived_at === null);

  return filtered.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Per-project progress from real task counts.
 *
 * Returns `percentage: null` when a project has no tasks, rather than `0`. Zero would render as
 * a progress bar that looks like a failing project, when the truth is that it has not started.
 * The UI shows an empty state for null and a bar otherwise.
 */
export async function computeProjectProgress(
  ctx: TaskServiceContext,
): Promise<ProjectProgress[]> {
  const db = getDatabase();

  const [projects, tasks] = await Promise.all([
    liveRowsFor(db.projects, ctx.userId),
    liveRowsFor(db.tasks, ctx.userId),
  ]);

  const counts = new Map<string, { total: number; completed: number }>();

  for (const task of tasks) {
    if (!task.project_id) continue;
    const entry = counts.get(task.project_id) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (task.completed) entry.completed += 1;
    counts.set(task.project_id, entry);
  }

  return projects
    .filter((project) => project.archived_at === null)
    .map((project) => {
      const entry = counts.get(project.id) ?? { total: 0, completed: 0 };
      return {
        project: { id: project.id, name: project.name, color: project.color },
        total: entry.total,
        completed: entry.completed,
        percentage: entry.total === 0 ? null : Math.round((entry.completed / entry.total) * 100),
      };
    })
    .sort((a, b) => a.project.name.localeCompare(b.project.name, undefined, { sensitivity: 'base' }));
}
