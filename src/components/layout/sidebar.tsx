'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft } from 'lucide-react';

import { NAV_ITEMS } from '@/components/layout/navigation';
import { getDatabase, liveRowsFor } from '@/lib/db/schema';
import { useActiveUserId } from '@/features/auth/session-context';
import { cn } from '@/lib/utils';

/**
 * Desktop sidebar.
 *
 * Collapsible to an icon rail, with the state persisted per device. The reason is that a power user
 * reading a long task list wants the width back, while a new user needs the labels. Neither default
 * suits both, so the choice is theirs and it is remembered.
 *
 * Live counts are shown for the views where a number is meaningful (overdue, today). They come from
 * Dexie, so they are accurate offline and update the instant a task is completed. The counts are
 * `aria-hidden` inside the link text as separate spans so a screen reader hears "Overdue, 3 tasks"
 * rather than reading the digits as a stray number.
 */

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  className?: string;
}

export function Sidebar({ collapsed, onToggleCollapsed, className }: SidebarProps) {
  const pathname = usePathname();
  const userId = useActiveUserId();

  const counts = useLiveQuery(
    async () => {
      const db = getDatabase();
      const today = localToday();

      const tasks = await liveRowsFor(db.tasks, userId);

      let overdue = 0;
      let todayCount = 0;
      let inbox = 0;

      for (const task of tasks) {
        if (task.completed) continue;

        if (task.due_date !== null && task.due_date < today) {
          overdue += 1;
        } else if (task.due_date === today) {
          todayCount += 1;
        }

        if (task.project_id === null) inbox += 1;
      }

      return { overdue, today: todayCount, inbox };
    },
    [userId],
    { overdue: 0, today: 0, inbox: 0 },
  );

  return (
    <nav
      aria-label="Main"
      className={cn(
        'hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-enter lg:flex',
        collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
        className,
      )}
    >
      <div className={cn('flex h-14 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          // Collapsed, the wordmark is hidden and the accessible name must still identify the link.
          aria-label="Todowork, go to dashboard"
        >
          <TodoworkMark />
          {!collapsed ? <span className="text-body font-semibold tracking-tight text-ink">Todowork</span> : null}
        </Link>

        {!collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-control text-ink-muted transition-colors duration-hover hover:bg-sunken hover:text-ink"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const badge = badgeFor(item.href, counts);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'group flex h-9 items-center gap-2.5 rounded-control px-2.5 text-body transition-colors duration-hover',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink-secondary hover:bg-sunken hover:text-ink',
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />

                {!collapsed ? (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge !== null ? (
                      <span
                        className={cn(
                          'tabular shrink-0 rounded px-1.5 text-meta',
                          badge.tone === 'danger'
                            ? 'bg-danger-soft text-danger'
                            : 'text-ink-muted',
                        )}
                      >
                        {badge.count}
                      </span>
                    ) : null}
                  </>
                ) : null}

                {collapsed && badge !== null && badge.count > 0 ? (
                  // Collapsed, the count is conveyed as an accessible suffix since the digit would
                  // otherwise be a bare number with no context.
                  <span className="sr-only">{badge.count} items</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {collapsed ? (
        <div className="flex justify-center border-t border-line p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors duration-hover hover:bg-sunken hover:text-ink"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4 rotate-180" />
          </button>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * The Todowork mark.
 *
 * A checkmark whose tail extends into a rail: the product's identity motif (the "work rail") plus the
 * universal completion gesture. Drawn as inline SVG in `currentColor` so it inherits the accent and
 * needs no second asset, and so it stays crisp at both the 20px rail size and the 32px auth size.
 *
 * This is a placeholder in the sense that antislop R-23 requires: a simple geometric mark derived
 * from the product's own concept, not a generated logo presented as final branding. If a designed
 * logo arrives, replace this component and the PWA icons together.
 */
export function TodoworkMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn('h-5 w-5 text-accent', className)}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  );
}

function badgeFor(
  href: string,
  counts: { overdue: number; today: number; inbox: number },
): { count: number; tone: 'muted' | 'danger' } | null {
  if (href === '/overdue' && counts.overdue > 0) return { count: counts.overdue, tone: 'danger' };
  if (href === '/my-day' && counts.today > 0) return { count: counts.today, tone: 'muted' };
  if (href === '/inbox' && counts.inbox > 0) return { count: counts.inbox, tone: 'muted' };
  return null;
}

/** Local calendar date, kept here so the sidebar does not import the whole date module. */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
