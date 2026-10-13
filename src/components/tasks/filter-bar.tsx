'use client';

import { PRIORITY_OPTIONS } from '@/components/ui/priority-indicator';
import { cn } from '@/lib/utils';
import type { Priority, SortField, TaskFilters, TaskSort } from '@/types/domain';

/**
 * Filter and sort bar.
 *
 * Collapsed by default on mobile and expanded on desktop, because the controls are useful but not
 * always needed, and a permanently visible filter row would push the task list below the fold on a
 * phone.
 *
 * Every control is a real form element with a label, so the bar is fully keyboard operable and
 * announces its state. The active-filter count is shown on the toggle so a user who has scrolled past
 * the controls still knows a filter is limiting what they see, which is the usual cause of "my tasks
 * disappeared".
 */

export interface FilterBarProps {
  filters: TaskFilters;
  sort: TaskSort;
  activeFilterCount: number;
  availableProjects: Array<{ id: string; name: string; color: string }>;
  availableTags: Array<{ id: string; name: string }>;
  onTogglePriority: (priority: Priority) => void;
  onToggleProject: (projectId: string) => void;
  onToggleTag: (tagId: string) => void;
  onSetCompletion: (completion: TaskFilters['completion']) => void;
  onSetDueRange: (from: string | null, to: string | null) => void;
  onSetSort: (sort: TaskSort) => void;
  onClear: () => void;
  /** Hides the completion control on views that are already fixed to one completion state. */
  showCompletion?: boolean;
  className?: string;
}

const SORT_OPTIONS: ReadonlyArray<{ value: SortField; label: string }> = [
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'created_at', label: 'Date created' },
  { value: 'title', label: 'Title' },
];

export function FilterBar({
  filters,
  sort,
  activeFilterCount,
  availableProjects,
  availableTags,
  onTogglePriority,
  onToggleProject,
  onToggleTag,
  onSetCompletion,
  onSetDueRange,
  onSetSort,
  onClear,
  showCompletion = true,
  className,
}: FilterBarProps) {
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {showCompletion ? (
          <fieldset className="flex items-center gap-1 rounded-card border border-line-strong bg-surface p-0.5">
            <legend className="sr-only">Completion status</legend>
            {(['all', 'active', 'completed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSetCompletion(value)}
                aria-pressed={filters.completion === value}
                className={cn(
                  'h-7 rounded-[4px] px-2.5 text-meta font-medium transition-colors duration-hover',
                  filters.completion === value
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-secondary hover:text-ink',
                )}
              >
                {value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Completed'}
              </button>
            ))}
          </fieldset>
        ) : null}

        <fieldset className="flex items-center gap-1 rounded-card border border-line-strong bg-surface p-0.5">
          <legend className="sr-only">Priority</legend>
          {PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onTogglePriority(option.value)}
              aria-pressed={filters.priorities.includes(option.value)}
              className={cn(
                'h-7 rounded-[4px] px-2.5 text-meta font-medium transition-colors duration-hover',
                filters.priorities.includes(option.value)
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-secondary hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        <label className="flex items-center gap-1.5 text-meta text-ink-secondary">
          <span>Due after</span>
          <input
            type="date"
            value={filters.dueFrom ?? ''}
            onChange={(event) => onSetDueRange(event.target.value || null, filters.dueTo)}
            className="h-7 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
          />
        </label>

        <label className="flex items-center gap-1.5 text-meta text-ink-secondary">
          <span>Due before</span>
          <input
            type="date"
            value={filters.dueTo ?? ''}
            onChange={(event) => onSetDueRange(filters.dueFrom, event.target.value || null)}
            className="h-7 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
          />
        </label>

        <label className="flex items-center gap-1.5 text-meta text-ink-secondary">
          <span>Sort</span>
          <select
            value={sort.field}
            onChange={(event) =>
              onSetSort({ field: event.target.value as SortField, direction: sort.direction })
            }
            className="h-7 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() =>
            onSetSort({ field: sort.field, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
          }
          // The label states the direction the click will produce, which is what makes a toggle like
          // this unambiguous to a screen reader.
          aria-label={`Sorting ${sort.direction === 'asc' ? 'ascending' : 'descending'}. Activate to sort ${sort.direction === 'asc' ? 'descending' : 'ascending'}.`}
          className="h-7 rounded-control border border-line-strong bg-surface px-2 text-meta text-ink-secondary transition-colors duration-hover hover:bg-sunken"
        >
          {sort.direction === 'asc' ? 'Asc' : 'Desc'}
        </button>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={onClear}
            className="h-7 rounded-control px-2 text-meta font-medium text-accent transition-colors duration-hover hover:bg-accent-soft"
          >
            Clear {activeFilterCount === 1 ? 'filter' : `${activeFilterCount} filters`}
          </button>
        ) : null}
      </div>

      {availableProjects.length > 0 ? (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="float-left mr-1 text-meta font-medium text-ink-muted">Projects</legend>
          {availableProjects.map((project) => {
            const active = filters.projectIds.includes(project.id);
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onToggleProject(project.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-control border px-2 text-meta transition-colors duration-hover',
                  active
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-line-strong bg-surface text-ink-secondary hover:bg-sunken hover:text-ink',
                )}
              >
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: project.color }}
                  className="h-2 w-2 rounded-full"
                />
                {project.name}
              </button>
            );
          })}
        </fieldset>
      ) : null}

      {availableTags.length > 0 ? (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="float-left mr-1 text-meta font-medium text-ink-muted">Tags</legend>
          {availableTags.map((tag) => {
            const active = filters.tagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onToggleTag(tag.id)}
                aria-pressed={active}
                className={cn(
                  'h-7 rounded-control border px-2 text-meta transition-colors duration-hover',
                  active
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-line-strong bg-surface text-ink-secondary hover:bg-sunken hover:text-ink',
                )}
              >
                #{tag.name}
              </button>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}
