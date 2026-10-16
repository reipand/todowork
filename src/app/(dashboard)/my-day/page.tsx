'use client';

import Link from 'next/link';

import { TaskListView } from '@/components/tasks/task-list-view';
import { todayCalendarDate } from '@/lib/utils/date';

/**
 * My Day.
 *
 * The fixed constraint is `dueTodayOnly`, which is what the navigation promises. It is applied as
 * a base filter, so no filter control on the page can talk the view out of it — a "My Day" that
 * could be made to show next month's tasks would not be My Day.
 *
 * Completed tasks are not excluded. A task finished an hour ago and due today is still part of what
 * today looked like, and `TaskList` already sinks completed rows to the bottom, so they do not get
 * in the way.
 */

export default function MyDayPage() {
  return (
    <TaskListView
      title="My Day"
      description="Everything due today. Add something here if you want it on today's list."
      baseFilters={{ dueTodayOnly: true }}
      quickAdd={{ defaultDueDate: todayCalendarDate() }}
      selectable
      emptyState={{
        title: 'Nothing due today',
        description:
          'Your day is clear. Add a task above to put something on it, or look at what is coming up next.',
        action: (
          <Link
            href="/upcoming"
            className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            See the next seven days
          </Link>
        ),
      }}
    />
  );
}
