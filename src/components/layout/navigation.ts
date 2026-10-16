import {
  CalendarDays,
  CheckCircle2,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Settings,
  Sun,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

/**
 * Navigation.
 *
 * Every entry here points at a route that exists. antislop R-24 forbids nav links to pages that have
 * not been built, so this list and the `src/app/(dashboard)` directory are kept in step; a link is
 * added only once its page is real.
 *
 * Icons: Lucide is mandated by the specification. Per antislop R-04 each icon carries a text label in
 * the sidebar and an accessible label on the mobile bar, so no icon is the sole carrier of meaning.
 * The glyphs chosen are semantically literal (a calendar for Calendar, a folder for Projects) rather
 * than decorative sparkle/lightning ornamentation, which R-04 forbids outright.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown on the mobile bottom bar. The bar holds five items so targets stay large. */
  primaryMobile: boolean;
  description: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    primaryMobile: false,
    description: 'Overview of your workload',
  },
  {
    href: '/my-day',
    label: 'My Day',
    icon: Sun,
    primaryMobile: true,
    description: 'Tasks due today and anything you flagged for today',
  },
  {
    href: '/tasks',
    label: 'All Tasks',
    icon: ListTodo,
    primaryMobile: true,
    description: 'Every task, with search, filters and sorting',
  },
  {
    href: '/upcoming',
    label: 'Upcoming',
    icon: CalendarDays,
    primaryMobile: false,
    description: 'Tasks due in the next seven days',
  },
  {
    href: '/overdue',
    label: 'Overdue',
    icon: TriangleAlert,
    primaryMobile: false,
    description: 'Tasks past their due date',
  },
  {
    href: '/completed',
    label: 'Completed',
    icon: CheckCircle2,
    primaryMobile: false,
    description: 'Tasks you have finished',
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderKanban,
    primaryMobile: true,
    description: 'Group tasks by project',
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    primaryMobile: true,
    description: 'Tasks laid out on your calendar',
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: Inbox,
    primaryMobile: false,
    description: 'Tasks with no project assigned',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    primaryMobile: true,
    description: 'Account, appearance, sync and data',
  },
];

/**
 * Items for the mobile bottom bar.
 *
 * Exactly five, which is the practical maximum before tap targets drop below the 44px minimum on a
 * narrow phone. Everything else is reachable from the drawer, and the drawer's content is the full
 * `NAV_ITEMS` list, so no destination is mobile-unreachable.
 */
export const MOBILE_NAV_ITEMS: readonly NavItem[] = NAV_ITEMS.filter((item) => item.primaryMobile);

/** Title and subtitle for a route, used by the page header. */
export function describeRoute(pathname: string): { title: string; description: string } {
  const exact = NAV_ITEMS.find((item) => item.href === pathname);
  if (exact) return { title: exact.label, description: exact.description };

  // Prefix match for nested routes such as /projects/<id>.
  const nested = NAV_ITEMS.find((item) => pathname.startsWith(`${item.href}/`));
  if (nested) return { title: nested.label, description: nested.description };

  return { title: 'Todowork', description: 'Organize your tasks. Own your time.' };
}
