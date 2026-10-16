'use client';

import Link from 'next/link';
import { useCallback } from 'react';

import { PriorityIndicator } from '@/components/ui/priority-indicator';
import { cn, truncate } from '@/lib/utils';
import { formatDueDate, isDueToday, isOverdue } from '@/lib/utils/date';
import type { TaskWithRelations } from '@/types/domain';

/**
 * Task row.
 *
 * Structure: a completion checkbox, the title, and a single meta line. The project's colour appears as
 * the left "work rail" (the product's identity motif), which encodes project membership at a glance
 * without adding a chip to every row.
 *
 * Status is never conveyed by colour alone:
 *   - overdue  -> the word "Overdue" is rendered, not just red text
 *   - priority -> a shaped glyph plus, in the detail panel, a text label
 *   - completed -> a checked box and a strikethrough, plus `aria-checked`
 *
 * The row is a list item containing a checkbox plus a link. That composition is deliberate: making the
 * whole row the checkbox would swallow the click needed to open the detail, and making the whole row a
 * single button would remove the checkbox as an independently focusable control.
 */

export interface TaskRowProps {
  task: TaskWithRelations;
  onToggleComplete: (task: TaskWithRelations) => void;
  onOpen: (task: TaskWithRelations) => void;
  /** Renders a leading checkbox for bulk selection. */
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (taskId: string, selected: boolean) => void;
  /** Highlights the row as the active selection in the detail panel. */
  isActive?: boolean;
}

export function TaskRow({
  task,
  onToggleComplete,
  onOpen,
  selectable = false,
  selected = false,
  onSelectChange,
  isActive = false,
}: TaskRowProps) {
  const overdue = isOverdue(task.due_date, task.completed);
  const dueToday = isDueToday(task.due_date);

  const handleToggle = useCallback(() => {
    onToggleComplete(task);
  }, [onToggleComplete, task]);

  const railColor = task.project?.color ?? null;

  return (
    <li
      className={cn(
        'group flex items-start gap-3 border-b border-line px-3 py-3 transition-colors duration-hover sm:px-4',
        isActive ? 'bg-accent-soft/60' : 'hover:bg-sunken/60',
      )}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectChange?.(task.id, event.target.checked)}
          // The title gives each checkbox a unique accessible name, so a screen reader user can tell
          // which task they are about to act on.
          aria-label={`Select ${task.title}`}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      ) : null}

      <CompletionCheckbox completed={task.completed} onToggle={handleToggle} taskTitle={task.title} />

      <div className="relative min-w-0 flex-1">
        {/* The work rail. Sized and coloured by the project, with a neutral fallback so a task with no
            project still reads as part of the list rather than looking broken. */}
        {railColor ? (
          <span
            aria-hidden="true"
            style={{ backgroundColor: railColor }}
            className="absolute -left-2 top-0.5 h-5 w-0.5 rounded-full"
          />
        ) : null}

        <button
          type="button"
          onClick={() => onOpen(task)}
          className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span
            className={cn(
              'block text-body',
              task.completed ? 'text-ink-muted line-through decoration-1' : 'text-ink',
            )}
          >
            {task.title}
          </span>

          {task.description ? (
            <span className="mt-0.5 block text-meta text-ink-muted">
              {truncate(task.description.replace(/\s+/g, ' '), 90)}
            </span>
          ) : null}
        </button>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-ink-muted">
          <PriorityIndicator priority={task.priority} />

          {task.due_date ? (
            <span className={cn('tabular', overdue && 'font-medium text-danger')}>
              {formatDueDate(task.due_date)}
              {/* The word, not only the colour. A user with colour-vision deficiency, or a user of a
                  monochrome display, still learns the task is late. */}
              {overdue ? <span className="ml-1 font-medium">Overdue</span> : null}
              {dueToday && !task.completed ? <span className="ml-1">Today</span> : null}
            </span>
          ) : null}

          {task.project ? (
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                style={{ backgroundColor: task.project.color }}
                className="h-2 w-2 rounded-full"
              />
              {task.project.name}
            </span>
          ) : null}

          {task.subtaskCount > 0 ? (
            <span className="tabular">
              {task.subtaskCompletedCount}/{task.subtaskCount} checklist
            </span>
          ) : null}

          {task.tags.length > 0 ? (
            <span className="truncate">
              {task.tags.map((tag) => `#${tag.name}`).join(' ')}
            </span>
          ) : null}

          {/* Sync state is shown per row, because a user needs to know WHICH task is not yet uploaded,
              not merely that something is pending. */}
          {task.sync_state === 'pending' ? (
            <span className="text-ink-muted" title="Waiting to sync">
              Not synced yet
            </span>
          ) : null}

          {task.sync_state === 'failed' ? (
            <span className="font-medium text-danger" title="This change could not be uploaded">
              Sync failed
            </span>
          ) : null}
        </div>
      </div>

      {task.sync_state === 'failed' ? (
        <Link
          href="/settings/sync"
          className="shrink-0 self-center rounded-control px-2 py-1 text-meta font-medium text-danger transition-colors duration-hover hover:bg-danger-soft"
        >
          Fix
        </Link>
      ) : null}
    </li>
  );
}

/**
 * Completion checkbox.
 *
 * A real `<input type="checkbox">` under a styled label. Using the native control keeps the platform's
 * keyboard behaviour, its `aria-checked` state, and its screen-reader announcement, none of which a
 * div-with-a-click-handler reproduces reliably.
 *
 * The checkmark draws in on completion, which is the one deliberate moment of motion in the product
 * (DESIGN.md, MOTION 1). It is suppressed under `prefers-reduced-motion`.
 */
function CompletionCheckbox({
  completed,
  onToggle,
  taskTitle,
}: {
  completed: boolean;
  onToggle: () => void;
  taskTitle: string;
}) {
  return (
    <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={completed}
        onChange={onToggle}
        aria-label={completed ? `Reopen ${taskTitle}` : `Complete ${taskTitle}`}
        className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded border border-line-strong bg-surface transition-colors duration-hover checked:border-accent checked:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />

      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className={cn(
          'pointer-events-none relative h-3 w-3 text-accent-fg',
          completed ? 'animate-check-draw' : 'opacity-0',
        )}
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.5 8.5 6.5 11.5 12.5 5" strokeDasharray="24" />
      </svg>
    </span>
  );
}
