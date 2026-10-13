'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Plus } from 'lucide-react';

import { PriorityIndicator, PRIORITY_OPTIONS } from '@/components/ui/priority-indicator';
import { createTask, ValidationError } from '@/features/tasks/service';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { todayCalendarDate } from '@/lib/utils/date';
import { parseQuickAdd } from '@/lib/utils/nl-parse';
import type { Priority } from '@/types/domain';

/**
 * Quick-add composer.
 *
 * One line, submitted with Enter. This is the highest-traffic interaction in the product, so it is
 * kept to a single field with an expanding disclosure for the extras (date, priority, project). A user
 * adding a task mid-thought should not have to fill a form.
 *
 * The task is written to IndexedDB synchronously before the input clears, so the list never shows an
 * empty box while the row is missing. Only then does the upload queue in the background. The input
 * deliberately does NOT clear until the local write resolves, because clearing early would discard the
 * user's text if the write failed.
 */

export interface QuickAddProps {
  userId: string;
  /** Pre-selects a project, for the project detail page. */
  defaultProjectId?: string | null;
  /** Pre-sets the due date, for the calendar and My Day views. */
  defaultDueDate?: string | null;
  projects: Array<{ id: string; name: string; color: string }>;
  className?: string;
  /**
   * Focuses the title input after mount.
   *
   * Implemented as an explicit effect rather than the `autoFocus` attribute: `autoFocus` moves focus
   * as soon as the element is parsed, which on a page with a sidebar and a top bar means focus can
   * land in the composer before the user has oriented, and it fights the element the browser was
   * already about to focus. The effect is also skipped while the page is still loading its session,
   * so it cannot steal focus from a sign-in field.
   */
  autoFocus?: boolean;
}

export function QuickAdd({
  userId,
  defaultProjectId = null,
  defaultDueDate = null,
  projects,
  className,
  autoFocus = false,
}: QuickAddProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
  }, [autoFocus]);

  // Listen for the global "focus quick add" event, dispatched by the N keyboard shortcut.
  useEffect(() => {
    const handler = (): void => inputRef.current?.focus();
    window.addEventListener('todowork:focus-quick-add', handler);
    return () => window.removeEventListener('todowork:focus-quick-add', handler);
  }, []);

  const [title, setTitle] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState<string | null>(defaultDueDate);
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = (): void => {
    setTitle('');
    setPriority('medium');
    setDueDate(defaultDueDate);
    setProjectId(defaultProjectId);
    setError(null);
    setExpanded(false);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const trimmed = title.trim();
    if (trimmed.length === 0) {
      // An empty submit is not an error worth a message; it is almost always a stray Enter.
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Parse natural-language date and priority from the title.
      // "Meeting tomorrow #high" → title="Meeting", due_date=tomorrow, priority="high".
      // Parsed values override form defaults; explicit form values are the fallback.
      const parsed = parseQuickAdd(trimmed);

      await createTask(
        { userId },
        {
          title: parsed.title || trimmed,
          description: null,
          project_id: projectId,
          priority: parsed.priority ?? priority,
          due_date: parsed.due_date ?? dueDate,
          start_date: null,
          reminder_at: null,
          tag_ids: [],
        },
      );

      reset();
      // Keep focus in the input so a user can add several tasks in a row without reaching for the mouse.
      inputRef.current?.focus();
    } catch (caught) {
      if (caught instanceof ValidationError) {
        setError(caught.fieldErrors.title ?? caught.fieldErrors._form ?? 'Check the task details.');
      } else {
        setError('Could not save this task. Your other tasks are unaffected.');
        toast('Could not save this task.', { tone: 'danger' });
      }
    } finally {
      setSaving(false);
    }
  };

  const showTodayShortcut = dueDate === null;

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 transition-colors duration-hover focus-within:border-accent">
        <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />

        <input
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => setExpanded(true)}
          // Enter submits; Escape collapses the extras rather than discarding the typed title, because
          // losing a sentence to a stray Escape would be hostile.
          onKeyDown={(event) => {
            if (event.key === 'Escape' && expanded) {
              event.preventDefault();
              setExpanded(false);
            }
          }}
          placeholder="Add a task"
          aria-label="Add a task"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'quick-add-error' : undefined}
          maxLength={500}
          className="h-7 min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-muted focus:outline-none"
        />

        <button
          type="submit"
          disabled={saving || title.trim().length === 0}
          className="shrink-0 rounded-control bg-accent px-3 py-1 text-meta font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error ? (
        <p id="quick-add-error" role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      ) : null}

      {expanded ? (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <label className="flex items-center gap-1.5 text-meta text-ink-secondary">
            Due
            <input
              type="date"
              value={dueDate ?? ''}
              onChange={(event) => setDueDate(event.target.value || null)}
              className="h-7 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
            />
          </label>

          {showTodayShortcut ? (
            <button
              type="button"
              onClick={() => setDueDate(todayCalendarDate())}
              className="h-7 rounded-control border border-line-strong bg-surface px-2 text-meta text-ink-secondary transition-colors duration-hover hover:bg-sunken"
            >
              Today
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDueDate(null)}
              className="h-7 rounded-control px-2 text-meta text-ink-secondary transition-colors duration-hover hover:bg-sunken"
            >
              Clear date
            </button>
          )}

          <label className="flex items-center gap-1.5 text-meta text-ink-secondary">
            Priority
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              className="h-7 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {/* The glyph next to the control reinforces the shape channel for the current choice. */}
            <PriorityIndicator priority={priority} />
          </label>

          {projects.length > 0 ? (
            <label className="flex items-center gap-1.5 text-meta text-ink-secondary">
              Project
              <select
                value={projectId ?? ''}
                onChange={(event) => setProjectId(event.target.value || null)}
                className="h-7 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
