import { getDatabase, liveRowsFor } from '@/lib/db/schema';
import { computeProjectProgress } from '@/features/projects/service';
import type { TaskServiceContext } from '@/features/tasks/service';
import {
  addCalendarDays,
  endOfWeek,
  isOverdue as computeIsOverdue,
  startOfWeek,
  todayCalendarDate,
} from '@/lib/utils/date';
import type { ActivityEntry, DashboardStats } from '@/types/domain';

/**
 * Dashboard analytics.
 *
 * Every figure is computed from the user's actual rows. There are no placeholder numbers, no
 * sample statistics, and no invented trend line: if the user has no data, the honest result is
 * zero or `null` and the UI renders an empty state. The spec forbids fabricated productivity
 * data, and a dashboard that flatters its user with invented numbers is worse than one that says
 * "nothing yet".
 *
 * Reads one snapshot of the task table and derives everything from it, so the numbers on a single
 * dashboard render cannot disagree with each other (a completed count that exceeds the total would
 * be the symptom of reading the table twice).
 */

export async function computeDashboardStats(ctx: TaskServiceContext): Promise<DashboardStats> {
  const db = getDatabase();

  const tasks = await liveRowsFor(db.tasks, ctx.userId);

  const today = todayCalendarDate();
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);
  const lastWeekStart = addCalendarDays(weekStart, -7);
  const lastWeekEnd = addCalendarDays(weekEnd, -7);

  let activeTotal = 0;
  let completedTotal = 0;
  let dueToday = 0;
  let overdue = 0;
  let upcoming = 0;
  let completedThisWeek = 0;
  let completedLastWeek = 0;

  const activity: ActivityEntry[] = [];

  for (const task of tasks) {
    if (task.completed) {
      completedTotal += 1;

      if (task.completed_at) {
        // `completed_at` is an instant, so it is projected onto a local calendar date before
        // being compared against week bounds. Comparing the raw instant against calendar strings
        // would be a type error and a timezone bug at once.
        const completedDate = new Date(task.completed_at);
        const completedCalendarDate = `${completedDate.getFullYear()}-${String(
          completedDate.getMonth() + 1,
        ).padStart(2, '0')}-${String(completedDate.getDate()).padStart(2, '0')}`;

        if (completedCalendarDate >= weekStart && completedCalendarDate <= weekEnd) {
          completedThisWeek += 1;
        } else if (completedCalendarDate >= lastWeekStart && completedCalendarDate <= lastWeekEnd) {
          completedLastWeek += 1;
        }

        activity.push({
          id: `completed:${task.id}`,
          taskId: task.id,
          taskTitle: task.title,
          kind: 'completed',
          at: task.completed_at,
        });
      }
    } else {
      activeTotal += 1;

      if (task.due_date === today) {
        dueToday += 1;
      } else if (task.due_date !== null && computeIsOverdue(task.due_date, task.completed)) {
        overdue += 1;
      } else if (task.due_date !== null && task.due_date > today) {
        // "Upcoming" means the next seven days, not everything in the future. A task due in six
        // months is not what the user needs surfaced on today's dashboard.
        const horizon = addCalendarDays(today, 7);
        if (task.due_date <= horizon) {
          upcoming += 1;
        }
      }
    }

    // Creation is an activity event in its own right, so a newly added task appears in the feed
    // even before anything is completed.
    activity.push({
      id: `created:${task.id}`,
      taskId: task.id,
      taskTitle: task.title,
      kind: 'created',
      at: task.created_at,
    });
  }

  const totalTasks = activeTotal + completedTotal;
  const completionRate = totalTasks === 0 ? null : Math.round((completedTotal / totalTasks) * 100);

  const projects = await computeProjectProgress(ctx);

  // Newest first, capped because the dashboard shows a short feed, not a full log. Capping after
  // sorting keeps the selection honest: it is the ten most recent events, not ten arbitrary ones.
  const recentActivity = activity
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  return {
    activeTotal,
    completedTotal,
    dueToday,
    overdue,
    upcoming,
    completionRate,
    completedThisWeek,
    completedLastWeek,
    projects,
    recentActivity,
  };
}

/**
 * Whether the account has any tasks at all.
 *
 * The dashboard uses this to distinguish "no tasks yet" from "no tasks match a filter". Those are
 * different situations and deserve different empty states: the first should teach the user how to
 * add a task, the second should offer to clear the filter.
 */
export async function hasAnyTasks(ctx: TaskServiceContext): Promise<boolean> {
  const db = getDatabase();
  const count = await liveRowsFor(db.tasks, ctx.userId).then((rows) => rows.length);
  return count > 0;
}

/**
 * Completion counts for the last seven days, oldest first.
 *
 * Returns real per-day counts. Days with no completions are present with a value of 0 rather than
 * omitted, so the bar chart shows a truthful flat line instead of silently compressing gaps.
 */
export async function computeWeeklyActivity(
  ctx: TaskServiceContext,
): Promise<Array<{ date: string; completed: number; created: number }>> {
  const db = getDatabase();
  const tasks = await liveRowsFor(db.tasks, ctx.userId);

  const today = todayCalendarDate();
  const days: Array<{ date: string; completed: number; created: number }> = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    days.push({ date: addCalendarDays(today, -offset), completed: 0, created: 0 });
  }

  const dayByDate = new Map(days.map((day) => [day.date, day]));

  const toCalendarDate = (iso: string): string => {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
  };

  for (const task of tasks) {
    const createdDate = toCalendarDate(task.created_at);
    const createdEntry = dayByDate.get(createdDate);
    if (createdEntry) createdEntry.created += 1;

    if (task.completed_at) {
      const completedDate = toCalendarDate(task.completed_at);
      const completedEntry = dayByDate.get(completedDate);
      if (completedEntry) completedEntry.completed += 1;
    }
  }

  return days;
}

/**
 * Tasks bucketed by due date, for the calendar view.
 *
 * Returns a map keyed by local calendar date so the calendar can look up a day's tasks in O(1)
 * while rendering its grid. Only tasks with a due date appear: undated tasks have no cell to live
 * in, and inventing one (for example "today") would misrepresent the user's own data.
 */
export async function tasksByDueDate(
  ctx: TaskServiceContext,
  rangeStart: string,
  rangeEnd: string,
): Promise<Map<string, Array<{ id: string; title: string; completed: boolean; priority: string; color: string | null }>>> {
  const db = getDatabase();

  const [tasks, projects] = await Promise.all([
    db.tasks
      .where('[user_id+due_date]')
      .between([ctx.userId, rangeStart], [ctx.userId, rangeEnd], true, true)
      .toArray(),
    liveRowsFor(db.projects, ctx.userId),
  ]);

  const projectColorById = new Map(projects.map((project) => [project.id, project.color]));
  const buckets = new Map<
    string,
    Array<{ id: string; title: string; completed: boolean; priority: string; color: string | null }>
  >();

  for (const task of tasks) {
    if (task.deleted_at !== null || !task.due_date) continue;

    const entry = {
      id: task.id,
      title: task.title,
      completed: task.completed,
      priority: task.priority,
      color: task.project_id ? (projectColorById.get(task.project_id) ?? null) : null,
    };

    const bucket = buckets.get(task.due_date);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(task.due_date, [entry]);
    }
  }

  return buckets;
}
