/**
 * Task export and import.
 *
 * Export reads live rows from the local Dexie database and packages them into a portable JSON
 * file. The format uses project names (not IDs) as the cross-reference between tasks and
 * projects, so an export from one account can be imported into another without ID collisions.
 *
 * Import priority is **database first, then local**: when cloud is configured and the user is
 * authenticated, rows are inserted directly into Supabase, then a sync pull brings them into
 * IndexedDB. In guest mode, rows go through the service layer (createProject / createTask /
 * createSubtask) which writes locally and queues mutations for a future sync.
 */

import { getDatabase, liveRowsFor } from '@/lib/db/schema';
import { isCloudConfigured, getSupabaseClient } from '@/lib/supabase/client';
import { nowIsoSafe, newId } from '@/lib/db/helpers';
import { createProject } from '@/features/projects/service';
import { createTask, updateTask } from '@/features/tasks/service';
import { createSubtask } from '@/features/tasks/subtask-service';
import type { Priority } from '@/types/domain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportData {
  version: 1;
  exportedAt: string;
  projects: ExportProject[];
  tasks: ExportTask[];
}

interface ExportProject {
  name: string;
  description: string | null;
  color: string;
}

interface ExportTask {
  title: string;
  description: string | null;
  completed: boolean;
  priority: Priority;
  due_date: string | null;
  start_date: string | null;
  reminder_at: string | null;
  completed_at: string | null;
  /** Index into the projects array, or null for no project. */
  projectIndex: number | null;
  subtasks: ExportSubtask[];
}

interface ExportSubtask {
  title: string;
  completed: boolean;
}

export interface ImportResult {
  projectsCreated: number;
  tasksCreated: number;
  subtasksCreated: number;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Reads all live (non-deleted) data for a user from the local database and returns a
 * portable JSON structure.
 */
export async function exportUserData(userId: string): Promise<ExportData> {
  const db = getDatabase();

  const [liveTasks, liveProjects, liveSubtasks] = await Promise.all([
    liveRowsFor(db.tasks, userId),
    liveRowsFor(db.projects, userId),
    liveRowsFor(db.subtasks, userId),
  ]);

  // Build a project id → index map so tasks can reference projects by position.
  const projectIndex = new Map(liveProjects.map((p, i) => [p.id, i]));

  return {
    version: 1,
    exportedAt: nowIsoSafe(),
    projects: liveProjects.map((p) => ({
      name: p.name,
      description: p.description,
      color: p.color,
    })),
    tasks: liveTasks.map((t) => ({
      title: t.title,
      description: t.description,
      completed: t.completed,
      priority: t.priority,
      due_date: t.due_date,
      start_date: t.start_date,
      reminder_at: t.reminder_at,
      completed_at: t.completed_at,
      projectIndex: t.project_id ? (projectIndex.get(t.project_id) ?? null) : null,
      subtasks: liveSubtasks
        .filter((s) => s.task_id === t.id)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ title: s.title, completed: s.completed })),
    })),
  };
}

/** Triggers a browser download of a JSON file. */
export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Imports data into Supabase directly (database first), then the caller triggers a sync
 * pull to bring the rows into the local database.
 *
 * New IDs are generated for every row so the import never collides with existing data.
 */
async function importToCloud(userId: string, data: ExportData): Promise<ImportResult> {
  const supabase = getSupabaseClient();
  let projectsCreated = 0;
  let tasksCreated = 0;
  let subtasksCreated = 0;

  // 1. Insert projects.
  const projectIdMap = new Map<number, string>();

  if (data.projects.length > 0) {
    const rows = data.projects.map((p) => ({
      id: newId(),
      user_id: userId,
      name: p.name,
      description: p.description,
      color: p.color,
    }));

    const { data: inserted, error } = await supabase
      .from('projects')
      .insert(rows)
      .select('id, name');

    if (error) throw new Error(`Projects: ${error.message}`);

    // Map original index → new Supabase id by matching on name (order may differ).
    for (let i = 0; i < data.projects.length; i += 1) {
      const name = data.projects[i]?.name;
      const match = inserted?.find((r) => r.name === name);
      if (match) projectIdMap.set(i, match.id);
    }

    projectsCreated = inserted?.length ?? 0;
  }

  // 2. Insert tasks (one by one to capture IDs for subtasks).
  for (const task of data.tasks) {
    const projectId =
      task.projectIndex !== null ? (projectIdMap.get(task.projectIndex) ?? null) : null;

    const { data: taskRow, error: taskError } = await supabase
      .from('tasks')
      .insert({
        id: newId(),
        user_id: userId,
        project_id: projectId,
        title: task.title,
        description: task.description,
        completed: task.completed,
        priority: task.priority,
        due_date: task.due_date,
        start_date: task.start_date,
        reminder_at: task.reminder_at,
        completed_at: task.completed_at,
      })
      .select('id')
      .single();

    if (taskError) throw new Error(`Tasks: ${taskError.message}`);
    tasksCreated += 1;

    // 3. Insert subtasks for this task.
    if (taskRow && task.subtasks.length > 0) {
      const subtaskRows = task.subtasks.map((s, i) => ({
        id: newId(),
        task_id: taskRow.id,
        user_id: userId,
        title: s.title,
        completed: s.completed,
        position: (i + 1) * 1000,
      }));

      const { error: subtaskError } = await supabase.from('task_subtasks').insert(subtaskRows);

      if (subtaskError) throw new Error(`Subtasks: ${subtaskError.message}`);
      subtasksCreated += task.subtasks.length;
    }
  }

  return { projectsCreated, tasksCreated, subtasksCreated };
}

/**
 * Imports data through the service layer, which writes to the local Dexie database and queues
 * sync mutations. Used when cloud is not configured (guest mode).
 */
async function importToLocal(userId: string, data: ExportData): Promise<ImportResult> {
  let projectsCreated = 0;
  let tasksCreated = 0;
  let subtasksCreated = 0;

  // 1. Create projects and map index → id.
  const projectIdMap = new Map<number, string>();

  for (let i = 0; i < data.projects.length; i += 1) {
    const p = data.projects[i];
    if (!p) continue;
    const project = await createProject({ userId }, {
      name: p.name,
      description: p.description,
      color: p.color,
    });
    projectIdMap.set(i, project.id);
    projectsCreated += 1;
  }

  // 2. Create tasks with subtasks.
  for (const task of data.tasks) {
    const projectId =
      task.projectIndex !== null ? (projectIdMap.get(task.projectIndex) ?? null) : null;

    const created = await createTask({ userId }, {
      title: task.title,
      description: task.description,
      priority: task.priority,
      due_date: task.due_date,
      start_date: task.start_date,
      reminder_at: task.reminder_at,
      project_id: projectId,
      tag_ids: [],
    });
    tasksCreated += 1;

    // Mark completed tasks (createTask always starts with completed=false).
    // The service sets completed_at automatically; the original timestamp is not preserved
    // on local import, but the completion state is.
    if (task.completed) {
      await updateTask({ userId }, created.id, { completed: true });
    }

    // Create subtasks.
    for (const subtask of task.subtasks) {
      await createSubtask({ userId }, { task_id: created.id, title: subtask.title });
      subtasksCreated += 1;
    }
  }

  return { projectsCreated, tasksCreated, subtasksCreated };
}

/**
 * Imports data with database-first priority.
 *
 * - Cloud configured + authenticated: writes to Supabase, caller triggers sync pull.
 * - Guest mode: writes to local Dexie via service layer.
 */
export async function importUserData(userId: string, data: ExportData): Promise<ImportResult> {
  if (isCloudConfigured()) {
    return importToCloud(userId, data);
  }
  return importToLocal(userId, data);
}

/**
 * Parses a JSON file from a File input and returns the validated ExportData, or throws
 * with a user-displayable message if the file is not valid.
 */
export function parseExportFile(text: string): ExportData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('File does not contain a valid export object.');
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.projects) || !Array.isArray(obj.tasks)) {
    throw new Error('File is not a Todowork export (version mismatch or missing fields).');
  }

  return obj as unknown as ExportData;
}
