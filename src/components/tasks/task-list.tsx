'use client';

import { useMemo, useState } from 'react';

import { TaskRow } from '@/components/tasks/task-row';
import { EmptyState, ErrorState, TaskListSkeleton } from '@/components/ui/states';
import { groupBy } from '@/lib/utils';
import type { TaskWithRelations } from '@/types/domain';

/**
 * Task list.
 *
 * Groups can be off, or by due date bucket, project, or priority. The grouping is computed from the
 * already-sorted array, so the order within each group follows the active sort rather than being
 * re-derived.
 *
 * Bulk selection appears only when `selectable` is on. The bar renders inside the list so it is next to
 * the rows it acts on, rather than pinned to the viewport where it would obscure content.
 */

export type GroupMode = 'none' | 'due' | 'project' | 'priority';

export interface TaskListProps {
  tasks: TaskWithRelations[] | undefined;
  isLoading: boolean;
  error?: Error | null;
  onToggleComplete: (task: TaskWithRelations) => void;
  onOpen: (task: TaskWithRelations) => void;
  onRetry?: () => void;
  activeTaskId?: string | null;
  selectable?: boolean;
  groupBy?: GroupMode;
  /** Retry handler for a bulk delete that failed. */
  onBulkAction?: (action: 'complete' | 'delete', taskIds: string[]) => void;
  /** Shown when the list is empty. Differentiates "no tasks at all" from "none match a filter". */
  emptyState: {
    title: string;
    description: string;
    action?: React.ReactNode;
  };
}

export function TaskList({
  tasks,
  isLoading,
  error,
  onToggleComplete,
  onOpen,
  onRetry,
  activeTaskId,
  selectable = false,
  groupBy: groupMode = 'none',
  onBulkAction,
  emptyState,
}: TaskListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Clear a selection that refers to rows no longer present, so a bulk action cannot target a task
  // that vanished because another device deleted it.
  const visibleIds = useMemo(() => new Set((tasks ?? []).map((task) => task.id)), [tasks]);
  const effectiveSelection = useMemo(
    () => new Set([...selectedIds].filter((id) => visibleIds.has(id))),
    [selectedIds, visibleIds],
  );

  const handleSelectChange = (taskId: string, selected: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  if (isLoading) {
    return <TaskListSkeleton rows={6} />;
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load your tasks"
        description="Your tasks are stored on this device. Reloading the view usually resolves this."
        {...(onRetry ? { onRetry } : {})}
      />
    );
  }

  if (!tasks || tasks.length === 0) {
    return <EmptyState {...emptyState} />;
  }

  const groups = buildGroups(tasks, groupMode);

  return (
    <div className="flex flex-col">
      {effectiveSelection.size > 0 && onBulkAction ? (
        <BulkActionBar
          count={effectiveSelection.size}
          onComplete={() => {
            onBulkAction('complete', [...effectiveSelection]);
            setSelectedIds(new Set());
          }}
          onDelete={() => {
            onBulkAction('delete', [...effectiveSelection]);
            setSelectedIds(new Set());
          }}
          onClear={() => setSelectedIds(new Set())}
        />
      ) : null}

      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          {groupMode !== 'none' ? (
            <h2 className="sticky top-14 z-10 border-b border-line bg-paper/95 px-3 py-2 text-meta font-semibold text-ink-secondary backdrop-blur-sm sm:px-4">
              {group.label}
              <span className="tabular ml-2 font-normal text-ink-muted">{group.tasks.length}</span>
            </h2>
          ) : null}

          <ul>
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggleComplete={onToggleComplete}
                onOpen={onOpen}
                {...(selectable
                  ? {
                      selectable: true,
                      selected: effectiveSelection.has(task.id),
                      onSelectChange: handleSelectChange,
                    }
                  : {})}
                isActive={activeTaskId === task.id}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface TaskGroup {
  key: string;
  label: string;
  tasks: TaskWithRelations[];
}

function buildGroups(tasks: TaskWithRelations[], mode: GroupMode): TaskGroup[] {
  if (mode === 'none') {
    return [{ key: 'all', label: 'All tasks', tasks }];
  }

  if (mode === 'project') {
    const grouped = groupBy(tasks, (task) => task.project?.name ?? 'No project');

    // Projects keep the order they first appear in, which follows the active sort. Sorting the group
    // keys alphabetically instead would break the link between the list's sort control and what the
    // user sees.
    return [...grouped.entries()].map(([label, groupTasks]) => ({
      key: `project:${label}`,
      label,
      tasks: groupTasks,
    }));
  }

  if (mode === 'priority') {
    const grouped = groupBy(tasks, (task) => task.priority);
    // Priority groups are ordered high to low deliberately: unlike projects, this bucket has an
    // intrinsic order that a user expects regardless of the sort field.
    const order = ['high', 'medium', 'low'] as const;
    const labels: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

    return order
      .filter((priority) => grouped.has(priority))
      .map((priority) => ({
        key: `priority:${priority}`,
        label: labels[priority] ?? priority,
        tasks: grouped.get(priority) ?? [],
      }));
  }

  // Due-date buckets.
  const grouped = groupBy(tasks, (task) => bucketFor(task));

  const labels: Record<string, string> = {
    overdue: 'Overdue',
    today: 'Today',
    tomorrow: 'Tomorrow',
    week: 'Next seven days',
    later: 'Later',
    none: 'No due date',
  };

  const order = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];

  return order
    .filter((key) => grouped.has(key))
    .map((key) => ({
      key: `due:${key}`,
      label: labels[key] ?? key,
      tasks: grouped.get(key) ?? [],
    }));
}

function bucketFor(task: TaskWithRelations): string {
  if (!task.due_date) return 'none';

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (task.due_date < today) return 'overdue';

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  if (task.due_date === today) return 'today';
  if (task.due_date === tomorrowKey) return 'tomorrow';

  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

  if (task.due_date <= weekEndKey) return 'week';
  return 'later';
}

/**
 * Bulk action bar.
 *
 * Delete requires a confirmation, which the caller owns: this bar only requests the action, so the
 * destructive confirmation dialog lives with the other dialogs rather than inside a list component.
 */
function BulkActionBar({
  count,
  onComplete,
  onDelete,
  onClear,
}: {
  count: number;
  onComplete: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky top-14 z-20 flex items-center gap-2 border-b border-line bg-accent-soft px-3 py-2 sm:px-4">
      <p className="tabular text-body font-medium text-ink">
        {count} selected
      </p>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onComplete}
          className="h-8 rounded-control border border-line-strong bg-surface px-2.5 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken"
        >
          Mark complete
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="h-8 rounded-control bg-danger px-2.5 text-meta font-medium text-white transition-opacity duration-hover hover:opacity-90"
        >
          Delete
        </button>

        <button
          type="button"
          onClick={onClear}
          className="h-8 rounded-control px-2 text-meta font-medium text-ink-secondary transition-colors duration-hover hover:bg-surface"
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}
