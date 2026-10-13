'use client';

import Link from 'next/link';

import { TaskListView } from '@/components/tasks/task-list-view';

/**
 * Overdue.
 *
 * `overdueOnly` is a convenience predicate because "past its due date and not completed" is not
 * expressible as a plain field comparison. It is a base filter, so this view stays what it claims
 * to be no matter what a user does with the filter bar.
 *
 * The sidebar already badges this route with the count in a danger tone, so a user knows before
 * opening it how much catching up they have. The empty state here is the payoff: clearing that
 * badge is the reward for the work.
 */

export default function OverduePage() {
  return (
    <TaskListView
      title="Overdue"
      description="Tasks past their due date. Clearing this list is the point of catching up."
      baseFilters={{ overdueOnly: true }}
      selectable
      emptyState={{
        title: 'Nothing overdue',
        description: 'You are up to date. Every task with a due date is either still ahead or finished.',
        action: (
          <Link
            href="/my-day"
            className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            See today
          </Link>
        ),
      }}
    />
  );
}
