'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';

import { PageContent, PageHeader, SectionHeading } from '@/components/layout/page-header';
import { EmptyState, ErrorState, Skeleton, StatsSkeleton } from '@/components/ui/states';
import { useActiveUserId, useDatabaseReady } from '@/features/auth/session-context';
import { computeDashboardStats } from '@/features/tasks/analytics';
import { formatRelativeInstant, todayCalendarDate } from '@/lib/utils/date';

/**
 * Dashboard.
 *
 * Every figure on this page comes from `computeDashboardStats`, which counts the user's own rows.
 * Nothing is estimated, sampled, or projected: a new account sees zeroes and an empty state, which
 * is the truth. The spec forbids fabricated productivity data, and a dashboard that flatters its
 * user with invented numbers is worse than one that says "nothing yet".
 *
 * An important display rule enforced here: `completionRate` is `null` when there is nothing to
 * compute a rate from, and `null` renders as an em dash. Rendering `0%` would claim a measured
 * failure where no measurement exists — a real distinction, and one a naive `?? 0` destroys.
 *
 * The three states are explicit: a stats skeleton while the live query resolves, an empty state
 * when the account has no tasks, and an error panel with a retry when the read fails.
 */

export default function DashboardPage() {
  const userId = useActiveUserId();
  const databaseReady = useDatabaseReady();

  const result = useLiveQuery(
    async () => {
      try {
        return { stats: await computeDashboardStats({ userId }), error: null as Error | null };
      } catch (caught) {
        return {
          stats: null,
          error: caught instanceof Error ? caught : new Error('Could not read your local data'),
        };
      }
    },
    [userId],
    undefined,
  );

  const stats = result?.stats ?? null;
  const error = result?.error ?? null;
  const isLoading = !databaseReady || result === undefined;

  /*
   * The one contextual lead.
   *
   * DESIGN.md's "one thing leads" rule asks a view to have a single obvious next action rather than
   * a row of competing ones. On a dashboard the answer depends on the data: late work outranks
   * today's work, and with neither there is nothing to lead with, so no action is shown at all.
   */
  const leadAction = (() => {
    if (!stats) return undefined;

    if (stats.overdue > 0) {
      return (
        <Link
          href="/overdue"
          className="inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
        >
          Review {stats.overdue} overdue
        </Link>
      );
    }

    if (stats.dueToday > 0) {
      return (
        <Link
          href="/my-day"
          className="inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
        >
          Open My Day
        </Link>
      );
    }

    return undefined;
  })();

  const hasNoTasks = stats !== null && stats.activeTotal === 0 && stats.completedTotal === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Overview of your workload for ${formatFullCalendarDate(todayCalendarDate())}`}
        {...(leadAction ? { action: leadAction } : {})}
      />

      <PageContent>
        {isLoading ? (
          <div className="flex flex-col gap-6">
            <StatsSkeleton cards={8} />
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ) : error ? (
          <ErrorState
            title="Could not load your dashboard"
            description="Your tasks are stored on this device and are unaffected. Reloading the view usually clears this."
            onRetry={() => window.location.reload()}
          />
        ) : !stats ? null : hasNoTasks ? (
          <EmptyState
            title="Nothing here yet"
            description="Add your first task and this dashboard will fill in with real counts: what is due, what is late, and what you have finished."
            action={
              <Link
                href="/tasks"
                className="inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
              >
                Add a task
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-8">
            <section aria-label="Task counts">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Active" value={stats.activeTotal} href="/tasks" />
                <StatCard label="Due today" value={stats.dueToday} href="/my-day" />
                <StatCard label="Overdue" value={stats.overdue} href="/overdue" tone="danger" />
                <StatCard label="Next 7 days" value={stats.upcoming} href="/upcoming" />
                <StatCard label="Completed" value={stats.completedTotal} href="/completed" />
                <StatCard label="Done this week" value={stats.completedThisWeek} />
                <StatCard label="Done last week" value={stats.completedLastWeek} />
                <StatCard
                  label="Completion rate"
                  // `null` means "no tasks to compute a rate from". An em dash is honest; `0%` would
                  // state a measurement that was never taken.
                  value={stats.completionRate === null ? '—' : stats.completionRate}
                  suffix={stats.completionRate === null ? undefined : '%'}
                  hint={stats.completionRate === null ? 'No tasks yet' : undefined}
                />
              </div>
            </section>

            <section aria-labelledby="projects-heading">
              <SectionHeading
                as="h2"
                action={
                  <Link
                    href="/projects"
                    className="rounded-control px-2 py-1 text-meta font-medium text-accent transition-colors duration-hover hover:bg-accent-soft"
                  >
                    All projects
                  </Link>
                }
              >
                <span id="projects-heading">Projects</span>
              </SectionHeading>

              {stats.projects.length === 0 ? (
                <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-body text-ink-secondary">
                  No projects yet. Projects group related tasks and give them a colour on the list.
                </p>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {stats.projects.map((entry) => (
                    <li key={entry.project.id}>
                      <Link
                        href={`/projects/${entry.project.id}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors duration-hover hover:bg-sunken/60"
                      >
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: entry.project.color }}
                          className="h-3 w-1 shrink-0 rounded-full"
                        />

                        <span className="min-w-0 flex-1 truncate text-body text-ink">
                          {entry.project.name}
                        </span>

                        <span className="tabular shrink-0 text-meta text-ink-muted">
                          {entry.completed}/{entry.total}
                        </span>

                        <span className="tabular w-12 shrink-0 text-right text-meta font-medium text-ink-secondary">
                          {/* A project with no tasks has no percentage. "—" rather than 0%. */}
                          {entry.percentage === null ? '—' : `${entry.percentage}%`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="activity-heading">
              <SectionHeading as="h2">
                <span id="activity-heading">Recent activity</span>
              </SectionHeading>

              {stats.recentActivity.length === 0 ? (
                <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-body text-ink-secondary">
                  Nothing has happened yet. Creating or completing a task will show up here.
                </p>
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {stats.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex items-baseline gap-3 px-4 py-2.5">
                      <span className="shrink-0 text-meta text-ink-muted">
                        {entry.kind === 'completed' ? 'Completed' : 'Created'}
                      </span>

                      <span className="min-w-0 flex-1 truncate text-body text-ink">
                        {entry.taskTitle}
                      </span>

                      <span className="shrink-0 text-meta text-ink-muted">
                        {formatRelativeInstant(entry.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </PageContent>
    </>
  );
}

/**
 * A single count.
 *
 * Rendered as a link only when there is a view that would actually show those tasks. The
 * "done last week" and completion-rate cards are plain figures because no route lists them, and
 * antislop R-24 forbids a link that leads nowhere useful.
 */
function StatCard({
  label,
  value,
  suffix,
  hint,
  href,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: string;
  href?: string;
  tone?: 'neutral' | 'danger';
}) {
  const body = (
    <>
      <span className="text-meta text-ink-muted">{label}</span>

      <span
        className={`tabular text-display ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}
      >
        {value}
        {suffix ? <span className="text-title">{suffix}</span> : null}
      </span>

      {hint ? <span className="text-meta text-ink-muted">{hint}</span> : null}
    </>
  );

  const shell =
    'flex flex-col gap-1 rounded-card border border-line bg-surface p-4';

  if (!href) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={href}
      className={`${shell} transition-colors duration-hover hover:border-line-strong hover:bg-sunken/60`}
    >
      {body}
    </Link>
  );
}

/** Long date for the header, built from the calendar-date helper so it cannot drift across zones. */
function formatFullCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return value;

  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}