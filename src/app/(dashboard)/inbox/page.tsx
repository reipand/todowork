'use client';

import Link from 'next/link';

import { TaskListView } from '@/components/tasks/task-list-view';
import type { TaskWithRelations } from '@/types/domain';

/**
 * Inbox.
 *
 * The inbox is "tasks with no project". The filter set has no predicate for that: `projectIds` is
 * a positive selection, and an empty `projectIds` matches everything, including projectless tasks.
 * So the constraint is applied as a `refine` predicate on top of the list, which runs in memory
 * after the already-filtered rows are in hand.
 *
 * A module-level predicate is passed rather than an inline closure so the `useMemo` in
 * `TaskListView` can depend on a stable identity and avoid recomputing on every render.
 */

function hasNoProject(task: TaskWithRelations): boolean {
  return task.project_id === null;
}

export default function InboxPage() {
  return (
    <TaskListView
      title="Inbox"
      description="Tasks with no project assigned. A place to capture things before you file them."
      quickAdd={{}}
      refine={hasNoProject}
      emptyState={{
        title: 'Inbox zero',
        description:
          'Every task belongs to a project. When you capture something without deciding where it goes, it lands here.',
        action: (
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            See all tasks
          </Link>
        ),
      }}
    />
  );
}
