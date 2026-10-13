'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The three states every data view must have.
 *
 * The spec requires loading, empty, and error states on every page, and antislop R-27 treats them as
 * part of a complete design rather than extras. Keeping them here means a page cannot accidentally
 * ship with only the happy path: it has to name what it shows in each case.
 */

export interface EmptyStateProps {
  title: string;
  /** One sentence on what to do next. An empty state that only states emptiness is a dead end. */
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        // Generous vertical padding: an empty state is the RHYTHM 2 break in an otherwise dense
        // list, so it should feel like a pause rather than a gap.
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <h2 className="text-title text-ink">{title}</h2>
      <p className="max-w-sm text-body text-ink-secondary">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** A retry affordance wherever the failure is retryable. Required for a good error state. */
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'This view could not be loaded. Your tasks are still safe on this device.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      // `role="alert"` so the failure is announced rather than silently rendered.
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}
    >
      <h2 className="text-title text-ink">{title}</h2>
      <p className="max-w-md text-body text-ink-secondary">{description}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-control border border-line-strong bg-surface px-3.5 py-2 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Skeleton block.
 *
 * Used while a live query resolves on first paint. `aria-hidden` because a screen reader should hear
 * the container's `aria-busy` state rather than a series of meaningless boxes.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-shimmer rounded-control bg-sunken', className)}
    />
  );
}

/**
 * Skeleton for a task list.
 *
 * Mirrors the real row's shape (rail, title line, meta line) so the layout does not shift when the
 * data arrives. Matching the shape is the entire point of a skeleton; a mismatched one makes the
 * transition feel like a jump.
 */
export function TaskListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for the dashboard's statistic grid. */
export function StatsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-12" />
        </div>
      ))}
    </div>
  );
}
