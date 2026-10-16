'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Page header.
 *
 * A consistent heading block for every route. Two reasons it is a component and not repeated markup:
 * it guarantees the single `<h1>` per page that the heading hierarchy depends on, and it keeps the
 * vertical rhythm identical across pages, which is what makes moving between views feel settled
 * rather than jumpy.
 */

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary action for the page, right-aligned on desktop and full width on a narrow phone. */
  action?: ReactNode;
  /** Secondary content below the title row, such as a filter bar or a count summary. */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, action, children, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 border-b border-line px-4 py-5 sm:px-6', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display text-ink">{title}</h1>
          {description ? <p className="text-body text-ink-secondary">{description}</p> : null}
        </div>

        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>

      {children}
    </header>
  );
}

/**
 * Content container.
 *
 * Caps the reading width and supplies the page's horizontal padding and bottom breathing room.
 * A task list wider than roughly 72rem becomes hard to scan, because the eye has to travel a long way
 * from a task title to its due date.
 */
export function PageContent({
  children,
  className,
  /** Removes padding for views that manage their own, such as the calendar grid. */
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-5xl', !flush && 'px-4 py-5 sm:px-6', className)}>
      {children}
    </div>
  );
}

/**
 * Section heading for a block inside a page.
 *
 * `as` lets the caller keep the heading order correct: a section inside a card is usually an `h3`
 * because the card itself carries the `h2`. Heading level is a structural fact, not a visual one, so
 * it is a prop rather than being derived from font size.
 */
export function SectionHeading({
  children,
  as: Tag = 'h2',
  action,
  className,
}: {
  children: ReactNode;
  as?: 'h2' | 'h3';
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <Tag
        className={cn(
          'text-ink',
          Tag === 'h2' ? 'text-title' : 'text-body font-semibold',
        )}
      >
        {children}
      </Tag>
      {action}
    </div>
  );
}
