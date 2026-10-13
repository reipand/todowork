'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { PageContent, PageHeader } from '@/components/layout/page-header';
import { FilterBar } from '@/components/tasks/filter-bar';
import { QuickAdd } from '@/components/tasks/quick-add';
import { TaskList, type GroupMode } from '@/components/tasks/task-list';
import { TaskDetailPanel, useTaskDetail } from '@/components/tasks/task-detail-panel';
import { ConfirmDialog } from '@/components/ui/dialog';
import { TaskListSkeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useActiveUserId, useDatabaseReady } from '@/features/auth/session-context';
import { hasAnyTasks } from '@/features/tasks/analytics';
import { bulkDeleteTasks, bulkSetCompleted } from '@/features/tasks/service';
import { useProjects, useTags, useTaskList } from '@/hooks/use-task-list';
import type { TaskFilters, TaskSort, TaskWithRelations } from '@/types/domain';

/**
 * Shared task list view.
 *
 * Six routes — All Tasks, My Day, Upcoming, Overdue, Completed and Inbox — are the same screen
 * with a different constraint and a different empty state. They are expressed here once instead of
 * six times, because six copies would drift: the seventh bug fix would land in five of them.
 *
 * What each route supplies:
 *   - `baseFilters`: the constraint that defines the view. It cannot be undone by a filter control,
 *     because `useTaskList` merges base filters *over* local state.
 *   - `emptyState`: what to say when the view has nothing in it. Distinct per route, because
 *     "nothing is overdue" and "you have not added a task yet" need different words.
 *   - `refine`: an optional predicate for a condition the filter set cannot express, used by Inbox
 *     ("has no project").
 *
 * The layout is a list column plus an optional detail column. The detail panel is a full-screen
 * overlay on a phone and a sticky side column from `lg` up, which is the same `TaskDetailPanel`
 * component in both cases — one instance, so there is one set of live queries and one copy of the
 * editing state.
 */

export interface TaskListViewProps {
  title: string;
  description: string;
  /** Applied on top of the user's own filters. Defines what the view is for. */
  baseFilters?: Partial<TaskFilters>;
  defaultSort?: TaskSort;
  /** Hides the filter bar entirely on views where filtering makes no sense. */
  showFilters?: boolean;
  /** Hides the completion segment on views already fixed to one completion state. */
  showCompletion?: boolean;
  groupBy?: GroupMode;
  /** Turns on bulk selection, which reveals the bulk action bar once rows are selected. */
  selectable?: boolean;
  /** Renders the quick-add composer in the header. Omitted on read-only views. */
  quickAdd?: { defaultProjectId?: string | null; defaultDueDate?: string | null };
  emptyState: { title: string; description: string; action?: ReactNode };
  headerAction?: ReactNode;
  /** Extra predicate for a condition the filter set cannot express, such as "no project". */
  refine?: (task: TaskWithRelations) => boolean;
  /**
   * A search term handed in from the URL, for the top bar's search field.
   *
   * Applied to the local filter state rather than to `baseFilters`, so the user can clear it: a
   * base filter cannot be undone from the filter bar, which is correct for a view's own constraint
   * and wrong for a search someone else put in the address bar.
   */
  initialSearch?: string;
}

export function TaskListView({
  title,
  description,
  baseFilters,
  defaultSort,
  showFilters = true,
  showCompletion = true,
  groupBy = 'none',
  selectable = false,
  quickAdd,
  emptyState,
  headerAction,
  refine,
  initialSearch,
}: TaskListViewProps) {
  const userId = useActiveUserId();
  const databaseReady = useDatabaseReady();
  const { toast } = useToast();

  // `useTaskList` memoises on the individual filter fields, so an inline object literal here does
  // not cause a re-query on every render.
  const list = useTaskList({ ...(baseFilters ? { baseFilters } : {}), ...(defaultSort ? { defaultSort } : {}) });

  const projects = useProjects(userId);
  const tags = useTags(userId);

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const detail = useTaskDetail(userId, activeTaskId);

  const [pendingBulk, setPendingBulk] = useState<{
    action: 'complete' | 'delete';
    taskIds: string[];
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  /**
   * Whether the account has any tasks at all.
   *
   * This is what separates "you have not started yet" from "nothing matches what you asked for".
   * Both render as an empty list, but only the second one is the user's own filter hiding their
   * work, and only the second one should offer to clear filters.
   */
  const anyTasks = useLiveQuery(() => hasAnyTasks({ userId }), [userId], undefined);

  const visibleTasks = useMemo(() => {
    if (!list.tasks) return undefined;
    if (!refine) return list.tasks;
    return list.tasks.filter(refine);
  }, [list.tasks, refine]);

  /**
   * Locks background scroll while the detail overlay is open on a narrow screen.
   *
   * Only on a narrow screen: from `lg` up the panel is a normal sticky column, and freezing the
   * page there would break scrolling a long list. The media query is re-evaluated on resize rather
   * than read once, so rotating a tablet does not leave the page permanently unscrollable.
   */
  useEffect(() => {
    if (!activeTaskId) return;

    const wideScreen = window.matchMedia('(min-width: 1024px)');

    const apply = (): void => {
      document.body.style.overflow = wideScreen.matches ? '' : 'hidden';
    };

    apply();
    wideScreen.addEventListener('change', apply);

    return () => {
      wideScreen.removeEventListener('change', apply);
      document.body.style.overflow = '';
    };
  }, [activeTaskId]);

  const runBulkAction = useCallback(
    (action: 'complete' | 'delete', taskIds: string[]): void => {
      setBulkBusy(true);

      const work =
        action === 'delete'
          ? bulkDeleteTasks({ userId }, taskIds)
          : bulkSetCompleted({ userId }, taskIds, true);

      void work
        .then((count) => {
          toast(
            action === 'delete'
              ? `${count} ${count === 1 ? 'task' : 'tasks'} deleted.`
              : `${count} ${count === 1 ? 'task' : 'tasks'} completed.`,
            { tone: 'success' },
          );
          setPendingBulk(null);
        })
        .catch(() => {
          // Deliberately not "nothing happened": a bulk action runs one transaction per row, so a
          // failure part-way through may have applied to some rows. The wording says what is true
          // rather than promising a rollback that does not exist.
          toast(
            'That bulk action did not finish. Some tasks may not have changed. Check the list and try again.',
            { tone: 'danger' },
          );
        })
        .finally(() => setBulkBusy(false));
    },
    [toast, userId],
  );

  const handleBulkRequest = useCallback(
    (action: 'complete' | 'delete', taskIds: string[]): void => {
      if (action === 'delete') {
        // Delete is the only destructive bulk action, so it is the only one that needs a dialog.
        // It routes through state so the confirmation dialog owns the decision, not this handler.
        setPendingBulk({ action, taskIds });
        return;
      }

      runBulkAction(action, taskIds);
    },
    [runBulkAction],
  );

  const hasActiveFilters = list.activeFilterCount > 0;
  const { setSearch } = list;

  /*
   * Seeds the search box from the address bar.
   *
   * The top bar navigates to `/tasks?q=term` rather than holding the term in component state, which
   * keeps a search shareable and back-button friendly. That only works if the term is read back
   * here. `setSearch` is stable (useCallback in useTaskList), so this runs when the URL changes and
   * not on every keystroke the user makes afterwards.
   */
  useEffect(() => {
    if (initialSearch === undefined) return;
    setSearch(initialSearch);
  }, [initialSearch, setSearch]);

  const resolvedEmptyState = useMemo(() => {
    // A filter the user applied is the likely reason the list looks empty, so say so and offer to
    // undo it. When nothing is filtered, the page's own empty state is the right message: it is
    // about the view, not about the filters.
    if (hasActiveFilters && anyTasks !== false) {
      return {
        title: 'No tasks match these filters',
        description:
          'Your tasks are still here. Removing a filter or clearing the search will bring them back.',
        action: (
          <button
            type="button"
            onClick={list.clearFilters}
            className="h-9 rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            Clear filters
          </button>
        ),
      };
    }

    return emptyState;
  }, [anyTasks, emptyState, hasActiveFilters, list.clearFilters]);

  const projectOptions = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.name, color: project.color })),
    [projects],
  );

  const tagOptions = useMemo(() => tags.map((tag) => ({ id: tag.id, name: tag.name })), [tags]);

  return (
    <>
      <PageHeader title={title} description={description} action={headerAction}>
        <div className="flex flex-col gap-4">
          {quickAdd ? (
            <QuickAdd
              userId={userId}
              projects={projectOptions}
              defaultProjectId={quickAdd.defaultProjectId ?? null}
              defaultDueDate={quickAdd.defaultDueDate ?? null}
            />
          ) : null}

          {showFilters ? (
            <FilterBar
              filters={list.filters}
              sort={list.sort}
              activeFilterCount={list.activeFilterCount}
              availableProjects={projectOptions}
              availableTags={tagOptions}
              onTogglePriority={list.togglePriority}
              onToggleProject={list.toggleProject}
              onToggleTag={list.toggleTag}
              onSetCompletion={list.setCompletion}
              onSetDueRange={list.setDueRange}
              onSetSort={list.setSort}
              onClear={list.clearFilters}
              showCompletion={showCompletion}
            />
          ) : null}
        </div>
      </PageHeader>

      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <PageContent flush>
            {!databaseReady ? (
              // The database is still opening. Rendering the list now would show an empty state for
              // a moment and then replace it with data, which reads as a glitch.
              <TaskListSkeleton rows={6} />
            ) : (
              <TaskList
                tasks={visibleTasks}
                isLoading={list.isLoading}
                error={list.error}
                onToggleComplete={list.toggleComplete}
                onOpen={(task) => setActiveTaskId(task.id)}
                // A reload is the honest retry here: the failure is a read that the live query
                // already gave up on, and re-mounting the whole view is what re-issues it.
                onRetry={() => window.location.reload()}
                activeTaskId={activeTaskId}
                selectable={selectable}
                groupBy={groupBy}
                onBulkAction={handleBulkRequest}
                emptyState={resolvedEmptyState}
              />
            )}
          </PageContent>
        </div>

        {activeTaskId ? (
          <div
            // Overlay on a phone, sticky column on a desktop. `lg:inset-auto` has to come before
            // `lg:top-14` in Tailwind's generated order for the sticky offset to win, which is the
            // order Tailwind emits `inset` and then the individual sides.
            className="fixed inset-0 z-40 bg-surface lg:sticky lg:inset-auto lg:top-14 lg:z-0 lg:h-[calc(100dvh-3.5rem)] lg:w-[22rem] lg:shrink-0 lg:self-start"
          >
            {detail ? (
              <TaskDetailPanel
                task={detail}
                userId={userId}
                projects={projectOptions}
                onClose={() => setActiveTaskId(null)}
                onDeleted={() => setActiveTaskId(null)}
              />
            ) : (
              // The selected row was deleted on another device, or the read is still resolving.
              // Either way the panel must not render a task that no longer exists.
              <div className="p-4">
                <TaskListSkeleton rows={3} />
                <p role="status" className="sr-only">
                  Loading task details
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingBulk?.action === 'delete'}
        onClose={() => setPendingBulk(null)}
        onConfirm={() => {
          if (pendingBulk) runBulkAction('delete', pendingBulk.taskIds);
        }}
        title={
          pendingBulk && pendingBulk.taskIds.length === 1
            ? 'Delete this task?'
            : `Delete ${pendingBulk?.taskIds.length ?? 0} tasks?`
        }
        description="They will be removed from this device and from your other devices when you are online. This cannot be undone."
        confirmLabel={pendingBulk && pendingBulk.taskIds.length === 1 ? 'Delete task' : 'Delete tasks'}
        tone="danger"
        busy={bulkBusy}
      />
    </>
  );
}
