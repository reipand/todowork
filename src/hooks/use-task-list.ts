'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo, useState } from 'react';

import { listTasks, setTaskCompleted } from '@/features/tasks/service';
import { useActiveUserId } from '@/features/auth/session-context';
import type { Priority, TaskFilters, TaskSort, TaskWithRelations } from '@/types/domain';

/**
 * Task list data hook.
 *
 * A live query, so any local write anywhere in the app re-renders this list immediately, including
 * writes made by the sync engine pulling remote changes. That is the payoff of reading from IndexedDB
 * rather than from a fetch: there is no cache to invalidate.
 *
 * Filters are memoised on their individual fields rather than on the object identity, so a caller that
 * recreates the filter object every render does not trigger a re-query on every render.
 */

export const DEFAULT_FILTERS: TaskFilters = {
  search: '',
  completion: 'all',
  priorities: [],
  projectIds: [],
  tagIds: [],
  dueFrom: null,
  dueTo: null,
  overdueOnly: false,
  dueTodayOnly: false,
};

export const DEFAULT_SORT: TaskSort = {
  field: 'due_date',
  direction: 'asc',
};

export interface UseTaskListOptions {
  /** Overrides applied on top of the caller's filter state, for the fixed views. */
  baseFilters?: Partial<TaskFilters>;
  defaultSort?: TaskSort;
}

export interface UseTaskListResult {
  tasks: TaskWithRelations[] | undefined;
  isLoading: boolean;
  error: Error | null;
  filters: TaskFilters;
  sort: TaskSort;
  setSearch: (search: string) => void;
  setCompletion: (completion: TaskFilters['completion']) => void;
  togglePriority: (priority: Priority) => void;
  toggleProject: (projectId: string) => void;
  toggleTag: (tagId: string) => void;
  setDueRange: (from: string | null, to: string | null) => void;
  setSort: (sort: TaskSort) => void;
  clearFilters: () => void;
  activeFilterCount: number;
  toggleComplete: (task: TaskWithRelations) => void;
}

export function useTaskList(options: UseTaskListOptions = {}): UseTaskListResult {
  const userId = useActiveUserId();
  const [localFilters, setLocalFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<TaskSort>(options.defaultSort ?? DEFAULT_SORT);

  const { baseFilters } = options;

  // Merge base filters over local state. Base filters win for fields the page owns, so a fixed view
  // cannot be talked out of its own constraint by a filter control.
  const filters = useMemo<TaskFilters>(
    () => ({ ...localFilters, ...baseFilters }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      localFilters.search,
      localFilters.completion,
      localFilters.priorities,
      localFilters.projectIds,
      localFilters.tagIds,
      localFilters.dueFrom,
      localFilters.dueTo,
      localFilters.overdueOnly,
      localFilters.dueTodayOnly,
      baseFilters?.completion,
      baseFilters?.overdueOnly,
      baseFilters?.dueTodayOnly,
      baseFilters?.dueFrom,
      baseFilters?.dueTo,
    ],
  );

  const queryResult = useLiveQuery(
    async () => {
      try {
        const tasks = await listTasks({ userId }, filters, sort);
        return { tasks, error: null as Error | null };
      } catch (caught) {
        // Surfaced as an error return rather than rethrown, because an unhandled rejection inside a
        // live query would leave the view stuck on its loading state with no explanation.
        return {
          tasks: undefined,
          error: caught instanceof Error ? caught : new Error('Could not read local tasks'),
        };
      }
    },
    // The filter and sort values are serialised into the dependency list so a new object with equal
    // contents does not re-run the query.
    [
      userId,
      filters.search,
      filters.completion,
      filters.priorities.join(','),
      filters.projectIds.join(','),
      filters.tagIds.join(','),
      filters.dueFrom,
      filters.dueTo,
      filters.overdueOnly,
      filters.dueTodayOnly,
      sort.field,
      sort.direction,
    ],
    undefined,
  );

  const toggleComplete = useCallback(
    (task: TaskWithRelations): void => {
      void setTaskCompleted({ userId }, task.id, !task.completed);
    },
    [userId],
  );

  const setSearch = useCallback((search: string) => {
    setLocalFilters((current) => ({ ...current, search }));
  }, []);

  const setCompletion = useCallback((completion: TaskFilters['completion']) => {
    setLocalFilters((current) => ({ ...current, completion }));
  }, []);

  const togglePriority = useCallback((priority: Priority) => {
    setLocalFilters((current) => ({
      ...current,
      priorities: current.priorities.includes(priority)
        ? current.priorities.filter((entry) => entry !== priority)
        : [...current.priorities, priority],
    }));
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    setLocalFilters((current) => ({
      ...current,
      projectIds: current.projectIds.includes(projectId)
        ? current.projectIds.filter((entry) => entry !== projectId)
        : [...current.projectIds, projectId],
    }));
  }, []);

  const toggleTag = useCallback((tagId: string) => {
    setLocalFilters((current) => ({
      ...current,
      tagIds: current.tagIds.includes(tagId)
        ? current.tagIds.filter((entry) => entry !== tagId)
        : [...current.tagIds, tagId],
    }));
  }, []);

  const setDueRange = useCallback((from: string | null, to: string | null) => {
    setLocalFilters((current) => ({ ...current, dueFrom: from, dueTo: to }));
  }, []);

  const clearFilters = useCallback(() => {
    // Base filters are preserved: clearing a fixed view's own constraint would let it show tasks it is
    // defined not to show.
    setLocalFilters((current) => ({ ...DEFAULT_FILTERS, completion: current.completion }));
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (localFilters.search.trim().length > 0) count += 1;
    if (localFilters.completion !== 'all') count += 1;
    count += localFilters.priorities.length;
    count += localFilters.projectIds.length;
    count += localFilters.tagIds.length;
    if (localFilters.dueFrom !== null || localFilters.dueTo !== null) count += 1;
    return count;
  }, [localFilters]);

  return {
    tasks: queryResult?.tasks,
    // `queryResult` is undefined only on the very first read, which is exactly when a skeleton is right.
    isLoading: queryResult === undefined,
    error: queryResult?.error ?? null,
    filters,
    sort,
    setSearch,
    setCompletion,
    togglePriority,
    toggleProject,
    toggleTag,
    setDueRange,
    setSort,
    clearFilters,
    activeFilterCount,
    toggleComplete,
  };
}

/** Loads the account's projects for pickers and filters. */
export function useProjects(userId: string, options: { includeArchived?: boolean } = {}) {
  const includeArchived = options.includeArchived === true;

  const projects = useLiveQuery(
    async () => {
      const { listProjects } = await import('@/features/projects/service');
      return listProjects({ userId }, { includeArchived });
    },
    [userId, includeArchived],
    [],
  );

  return projects ?? [];
}

/** Loads the account's tags. */
export function useTags(userId: string) {
  const tags = useLiveQuery(
    async () => {
      const { listTags } = await import('@/features/projects/tag-service');
      return listTags({ userId });
    },
    [userId],
    [],
  );

  return tags ?? [];
}
