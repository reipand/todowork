'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageContent, PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useActiveUserId, useDatabaseReady } from '@/features/auth/session-context';
import { tasksByDueDate } from '@/features/tasks/analytics';
import { createTask, ValidationError } from '@/features/tasks/service';
import { useProjects } from '@/hooks/use-task-list';
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateRange,
  endOfMonth,
  endOfWeek,
  parseCalendarDate,
  startOfMonth,
  startOfWeek,
  todayCalendarDate,
} from '@/lib/utils/date';
import { cn } from '@/lib/utils';
import type { Priority } from '@/types/domain';

/**
 * Calendar.
 *
 * Three views — month, week, day — over the same data source, `tasksByDueDate`, which buckets
 * tasks with a due date by local calendar day. Tasks without a due date have no cell to live in,
 * and inventing one (forcing them onto "today") would misrepresent the user's own data, so they
 * are simply absent here.
 *
 * Tapping a day in the month or week view opens it in the day view. That is the mobile-friendly
 * path: a dense month grid on a phone is illegible, and drilling in is how a small screen stays
 * useful without a separate design.
 *
 * The week starts Monday, matching the rest of the app. Week-start is hardcoded rather than
 * locale-derived so two devices in a multi-device sync product agree on what "this week" contains.
 */

type ViewMode = 'month' | 'week' | 'day';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** A task as returned by `tasksByDueDate`, narrowed to the fields this view renders. */
interface DayTask {
  id: string;
  title: string;
  completed: boolean;
  priority: string;
  color: string | null;
}

export default function CalendarPage() {
  const userId = useActiveUserId();
  const databaseReady = useDatabaseReady();
  const projects = useProjects(userId);

  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState<string>(todayCalendarDate());

  const range = useMemo(() => computeRange(view, anchor), [view, anchor]);

  const result = useLiveQuery(
    async () => {
      try {
        const buckets = await tasksByDueDate({ userId }, range.start, range.end);
        return { buckets, error: null as Error | null };
      } catch (caught) {
        return {
          buckets: null,
          error: caught instanceof Error ? caught : new Error('Could not read tasks for this period'),
        };
      }
    },
    [userId, range.start, range.end],
    undefined,
  );

  const buckets = result?.buckets ?? null;
  const error = result?.error ?? null;
  const isLoading = !databaseReady || result === undefined;

  const taskCount = useMemo(() => {
    if (!buckets) return 0;
    let total = 0;
    for (const list of buckets.values()) total += list.length;
    return total;
  }, [buckets]);

  const goTo = useCallback((next: string) => setAnchor(next), []);

  const step = useCallback(
    (direction: 1 | -1) => {
      setAnchor((current) => {
        if (view === 'month') return addCalendarMonths(current, direction);
        if (view === 'week') return addCalendarDays(current, direction * 7);
        return addCalendarDays(current, direction);
      });
    },
    [view],
  );

  return (
    <>
      <PageHeader title="Calendar" description="Tasks with a due date, laid out on your calendar.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={view === 'month' ? 'Previous month' : view === 'week' ? 'Previous week' : 'Previous day'}
              className="flex h-9 w-9 items-center justify-center rounded-control border border-line-strong bg-surface text-ink-secondary transition-colors duration-hover hover:bg-sunken hover:text-ink"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => goTo(todayCalendarDate())}
              className="h-9 rounded-control border border-line-strong bg-surface px-3 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken"
            >
              Today
            </button>

            <button
              type="button"
              onClick={() => step(1)}
              aria-label={view === 'month' ? 'Next month' : view === 'week' ? 'Next week' : 'Next day'}
              className="flex h-9 w-9 items-center justify-center rounded-control border border-line-strong bg-surface text-ink-secondary transition-colors duration-hover hover:bg-sunken hover:text-ink"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>

            <p className="ml-2 text-body font-medium text-ink" aria-live="polite">
              {formatAnchorLabel(view, anchor)}
            </p>
          </div>

          <fieldset className="flex items-center gap-1 rounded-control border border-line-strong bg-surface p-0.5">
            <legend className="sr-only">Calendar view</legend>
            {(['month', 'week', 'day'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                aria-pressed={view === value}
                className={cn(
                  'h-7 rounded-[4px] px-2.5 text-meta font-medium capitalize transition-colors duration-hover',
                  view === value ? 'bg-accent-soft text-accent' : 'text-ink-secondary hover:text-ink',
                )}
              >
                {value}
              </button>
            ))}
          </fieldset>
        </div>
      </PageHeader>

      <PageContent flush>
        {isLoading ? (
          <CalendarSkeleton view={view} />
        ) : error ? (
          <ErrorState
            title="Could not load the calendar"
            description="Your tasks are stored on this device and are unaffected. Reloading usually clears this."
            onRetry={() => window.location.reload()}
          />
        ) : !buckets || taskCount === 0 ? (
          <EmptyState
            title="No tasks in this period"
            description="Nothing with a due date falls in this range. Tasks without a due date do not appear on the calendar."
          />
        ) : view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            buckets={buckets}
            onSelectDay={(date) => {
              setView('day');
              goTo(date);
            }}
          />
        ) : view === 'week' ? (
          <WeekGrid
            anchor={anchor}
            buckets={buckets}
            onSelectDay={(date) => {
              setView('day');
              goTo(date);
            }}
          />
        ) : (
          <DayView
            anchor={anchor}
            buckets={buckets}
            userId={userId}
            projects={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
          />
        )}
      </PageContent>
    </>
  );
}

/** Visible start and end for a view, always aligned to week boundaries so the grid is rectangular. */
function computeRange(view: ViewMode, anchor: string): { start: string; end: string } {
  if (view === 'month') {
    return {
      start: startOfWeek(startOfMonth(anchor)),
      end: endOfWeek(endOfMonth(anchor)),
    };
  }

  if (view === 'week') {
    return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
  }

  return { start: anchor, end: anchor };
}

function formatAnchorLabel(view: ViewMode, anchor: string): string {
  const date = parseCalendarDate(anchor);

  if (view === 'month') {
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  if (view === 'week') {
    const start = startOfWeek(anchor);
    const end = endOfWeek(anchor);
    const startLabel = parseCalendarDate(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel = parseCalendarDate(end).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(parseCalendarDate(start).getFullYear() !== parseCalendarDate(end).getFullYear()
        ? { year: 'numeric' }
        : {}),
    });
    return `${startLabel} – ${endLabel}`;
  }

  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function CalendarSkeleton({ view }: { view: ViewMode }) {
  if (view === 'day') {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-control" />
        ))}
      </div>
    );
  }

  const rows = view === 'month' ? 6 : 1;
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="pb-1 text-center text-meta text-ink-muted">
            {label}
          </div>
        ))}
      </div>
      {Array.from({ length: rows * 7 }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-control" />
      ))}
    </div>
  );
}

/**
 * Month grid.
 *
 * Cells from the previous or next month are rendered muted, which is the standard calendar
 * convention and the one that keeps the grid rectangular without inventing tasks for days that
 * do not belong. Each cell shows up to two titles on a wide screen and a count badge always, so a
 * phone user still learns how busy a day is without legible text.
 */
function MonthGrid({
  anchor,
  buckets,
  onSelectDay,
}: {
  anchor: string;
  buckets: Map<string, DayTask[]>;
  onSelectDay: (date: string) => void;
}) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const days = calendarDateRange(gridStart, gridEnd);
  const weeks: string[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  const today = todayCalendarDate();

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="pb-1 text-center text-meta text-ink-muted">
            {label}
          </div>
        ))}
      </div>

      {weeks.map((week, weekIndex) => (
        <div key={weekIndex} className="grid grid-cols-7 gap-1">
          {week.map((date) => {
            const inMonth = date >= monthStart && date <= monthEnd;
            const tasks = buckets.get(date) ?? [];
            const isToday = date === today;

            return (
              <button
                key={date}
                type="button"
                onClick={() => onSelectDay(date)}
                aria-label={describeDay(date, tasks)}
                className={cn(
                  'flex min-h-20 flex-col items-stretch gap-1 rounded-control border p-1.5 text-left transition-colors duration-hover',
                  inMonth ? 'border-line bg-surface hover:border-line-strong' : 'border-line/60 bg-sunken/40',
                  isToday && 'ring-1 ring-inset ring-accent',
                )}
              >
                <span
                  className={cn(
                    'tabular self-end text-meta',
                    inMonth ? (isToday ? 'font-semibold text-accent' : 'text-ink-secondary') : 'text-ink-muted',
                  )}
                >
                  {parseCalendarDate(date).getDate()}
                </span>

                <span className="flex flex-col gap-0.5 overflow-hidden">
                  {tasks.slice(0, 2).map((task) => (
                    <DayTaskPill key={task.id} task={task} />
                  ))}
                </span>

                {tasks.length > 2 ? (
                  <span className="tabular mt-auto self-start text-meta text-ink-muted">
                    +{tasks.length - 2} more
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekGrid({
  anchor,
  buckets,
  onSelectDay,
}: {
  anchor: string;
  buckets: Map<string, DayTask[]>;
  onSelectDay: (date: string) => void;
}) {
  const start = startOfWeek(anchor);
  const days = calendarDateRange(start, endOfWeek(anchor));
  const today = todayCalendarDate();

  return (
    <div className="flex flex-col gap-2">
      {days.map((date) => {
        const tasks = buckets.get(date) ?? [];
        const isToday = date === today;

        return (
          <section key={date} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <h2
                className={cn(
                  'text-body font-medium',
                  isToday ? 'text-accent' : 'text-ink',
                )}
              >
                {parseCalendarDate(date).toLocaleDateString(undefined, { weekday: 'long' })}
              </h2>
              <span className="tabular text-meta text-ink-muted">
                {parseCalendarDate(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>

            {tasks.length === 0 ? (
              <button
                type="button"
                onClick={() => onSelectDay(date)}
                className="rounded-control border border-dashed border-line px-3 py-2 text-left text-meta text-ink-muted transition-colors duration-hover hover:bg-sunken/40"
              >
                No tasks. Tap to open this day.
              </button>
            ) : (
              <ul className="flex flex-col gap-1">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => onSelectDay(date)}
                      className="flex w-full items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-left transition-colors duration-hover hover:bg-sunken/60"
                    >
                      <DayTaskPill task={task} inline />
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-body',
                          task.completed ? 'text-ink-muted line-through' : 'text-ink',
                        )}
                      >
                        {task.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DayView({
  anchor,
  buckets,
  userId,
  projects,
}: {
  anchor: string;
  buckets: Map<string, DayTask[]>;
  userId: string;
  projects: Array<{ id: string; name: string; color: string }>;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tasks = buckets.get(anchor) ?? [];
  const today = todayCalendarDate();
  const isToday = anchor === today;

  const handleAdd = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    setBusy(true);
    try {
      await createTask(
        { userId },
        {
          title: trimmed,
          description: null,
          project_id: projectId,
          priority,
          due_date: anchor,
          start_date: null,
          reminder_at: null,
          tag_ids: [],
        },
      );
      setTitle('');
      setPriority('medium');
      setProjectId(null);
    } catch (caught) {
      if (caught instanceof ValidationError) {
        toast(caught.fieldErrors.title ?? caught.fieldErrors._form ?? 'Check the task details.', { tone: 'danger' });
      } else {
        toast('Could not save this task.', { tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => void handleAdd(event)}
        className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3"
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={`Add a task due ${isToday ? 'today' : formatShortDate(anchor)}`}
          aria-label="Add a task for this day"
          maxLength={500}
          className="h-8 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-2 text-body text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
        />

        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
          aria-label="Priority"
          className="h-8 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {projects.length > 0 ? (
          <select
            value={projectId ?? ''}
            onChange={(event) => setProjectId(event.target.value || null)}
            aria-label="Project"
            className="h-8 rounded-control border border-line-strong bg-surface px-1.5 text-meta text-ink"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="submit"
          disabled={busy || title.trim().length === 0}
          className="h-8 rounded-control bg-accent px-3 text-meta font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover disabled:opacity-45"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>

      {tasks.length === 0 ? (
        <EmptyState
          title={`Nothing due ${isToday ? 'today' : 'on this day'}`}
          description="Add a task above, or pick another day from the month or week view."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2"
            >
              {task.color ? (
                <span aria-hidden="true" style={{ backgroundColor: task.color }} className="h-3 w-1 shrink-0 rounded-full" />
              ) : null}

              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-body',
                  task.completed ? 'text-ink-muted line-through' : 'text-ink',
                )}
              >
                {task.title}
              </span>

              <PriorityGlyph priority={task.priority} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A compact pill for a task inside a calendar cell. `inline` swaps block for inline flow. */
function DayTaskPill({ task, inline = false }: { task: DayTask; inline?: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1 truncate rounded px-1 py-0.5 text-meta',
        task.completed ? 'text-ink-muted line-through' : 'text-ink',
        inline ? 'inline-flex' : 'flex',
      )}
      style={task.color ? { backgroundColor: `${task.color}22` } : undefined}
    >
      {task.color ? (
        <span aria-hidden="true" style={{ backgroundColor: task.color }} className="h-1.5 w-1.5 shrink-0 rounded-full" />
      ) : null}
      <span className="truncate">{task.title}</span>
    </span>
  );
}

/** A tiny priority glyph, mirroring `PriorityIndicator`'s shape channel at cell size. */
function PriorityGlyph({ priority }: { priority: string }) {
  const glyph = priority === 'high' ? '▲' : priority === 'medium' ? '■' : '●';
  const tone =
    priority === 'high' ? 'text-priority-high' : priority === 'medium' ? 'text-priority-medium' : 'text-priority-low';

  return (
    <span aria-hidden="true" className={cn('shrink-0 text-[0.625rem] leading-none', tone)}>
      {glyph}
    </span>
  );
}

function describeDay(date: string, tasks: DayTask[]): string {
  const label = parseCalendarDate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  if (tasks.length === 0) return `${label}, no tasks`;
  return `${label}, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
}

function formatShortDate(value: string): string {
  return parseCalendarDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
