'use client';

import Link from 'next/link';

import { TaskListView } from '@/components/tasks/task-list-view';

/**
 * Completed.
 *
 * The completion segment of the filter bar is hidden here because the view is fixed to "completed"
 * — offering "active" or "all" would contradict the route. The default sort is newest-finished
 * first, which is what a user reviewing what they just did expects, rather than the due-date sort
 * the other views use.
 */

export default function CompletedPage() {
  return (
    <TaskListView
      title="Completed"
      description="Tasks you have finished, newest first."
      baseFilters={{ completion: 'completed' }}
      showCompletion={false}
      defaultSort={{ field: 'created_at', direction: 'desc' }}
      emptyState={{
        title: 'Nothing finished yet',
        description: 'Completing a task moves it here. Your finished work is kept so you can look back.',
        action: (
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            Go to all tasks
          </Link>
        ),
      }}
    />
  );
}
