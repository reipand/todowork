'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { TaskListView } from '@/components/tasks/task-list-view';
import { TaskListSkeleton } from '@/components/ui/states';

/**
 * All Tasks.
 *
 * The only fully unfiltered view, so it is the one that carries the full filter bar, bulk selection,
 * and the quick-add composer. Every other list view is this screen with a constraint applied.
 *
 * Search arrives from the top bar as `?q=`, which is why the inner component is wrapped in a
 * Suspense boundary: `useSearchParams` suspends during a static export's prerender pass, and
 * without the boundary the build fails rather than the page degrading.
 */

export default function TasksPage() {
  return (
    <Suspense
      // Matches the settled layout so the swap into real content does not shift the page.
      fallback={
        <div className="flex flex-col">
          <div className="border-b border-line px-4 py-5 sm:px-6">
            <h1 className="text-display text-ink">All Tasks</h1>
          </div>
          <TaskListSkeleton rows={6} />
        </div>
      }
    >
      <TasksPageInner />
    </Suspense>
  );
}

function TasksPageInner() {
  const searchParams = useSearchParams();

  // A plain string rather than the params object, so the value passed down is stable across
  // renders and does not retrigger the effect that seeds the search field.
  const search = searchParams.get('q') ?? '';

  return (
    <TaskListView
      title="All Tasks"
      description="Every task in this account, with search, filters and sorting."
      quickAdd={{}}
      selectable
      initialSearch={search}
      groupBy="due"
      emptyState={{
        title: 'No tasks yet',
        description:
          'Add your first task above. It saves to this device immediately, so it is there whether or not you are online.',
      }}
    />
  );
}
