'use client';

import Link from 'next/link';

import { TaskListView } from '@/components/tasks/task-list-view';
import { addDaysFromToday, todayCalendarDate } from '@/lib/utils/date';

/**
 * Upcoming.
 *
 * The fixed constraint is an inclusive seven-day due-date window starting today, expressed through
 * `dueFrom`/`dueTo` rather than a `dueTodayOnly`-style boolean because the filter set has no other
 * way to name a range. As a base filter it cannot be widened or narrowed from the filter bar, which
 * is the point: "the next seven days" is what this view means.
 *
 * Undated tasks are excluded by definition, because a task with no due date has no place on a
 * horizon. That exclusion is a property of `applyFilters`, not of this page.
 */

export default function UpcomingPage() {
  return (
    <TaskListView
      title="Upcoming"
      description="Tasks due in the next seven days."
      baseFilters={{ dueFrom: todayCalendarDate(), dueTo: addDaysFromToday(7) }}
      groupBy="due"
      emptyState={{
        title: 'Nothing due this week',
        description:
          'You have nothing scheduled for the next seven days. Anything beyond that shows up here as its date approaches.',
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
