import type { Metadata } from 'next';
import Link from 'next/link';

import { TodoworkMark } from '@/components/layout/sidebar';

/**
 * 404.
 *
 * A real page rather than the framework default. Two reasons: the default 404 is unbranded and
 * offers no way back into the app, and an installed PWA that hits an unknown route would otherwise
 * show a bare browser error with no navigation.
 *
 * Deliberately a server component with no data access. A 404 must render even when IndexedDB is
 * blocked, the session is unknown, or a chunk failed to load — which is exactly the situation
 * where a client-side data dependency would leave the user staring at a blank screen.
 */

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper px-6 py-16 text-center">
      <TodoworkMark className="h-8 w-8" />

      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-display text-ink">This page does not exist</h1>
        <p className="text-body text-ink-secondary">
          The link may be out of date, or the address may have been typed incorrectly. Your tasks
          are unaffected and still on this device.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
        >
          Go to dashboard
        </Link>

        <Link
          href="/tasks"
          className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
        >
          Open all tasks
        </Link>
      </div>
    </div>
  );
}
