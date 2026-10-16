'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { ErrorState } from '@/components/ui/states';

/**
 * Route error boundary.
 *
 * Without this, a render failure anywhere in the tree produces Next.js's development overlay in
 * development and a blank white page in production. For an offline-first app that is a
 * particularly bad failure: the user's tasks are still safely in IndexedDB, but a blank page gives
 * them no way to know that, and no way to recover short of clearing site data.
 *
 * The boundary therefore does three things: says the data is safe, offers a retry, and offers a
 * route out. It is a client component by requirement — error boundaries need lifecycle state.
 */

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged rather than rendered. A raw stack trace in the UI is noise to the user and can leak
    // internals; the console keeps it available for a developer or a bug report. The digest is
    // Next.js's server-side correlation id and is the only part worth surfacing in the UI.
    console.error('[error-boundary] render failed', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 py-16">
      <div className="w-full max-w-md">
        <ErrorState
          title="This screen could not be displayed"
          description="Something failed while rendering. Your tasks are stored on this device and have not been lost."
          onRetry={reset}
        />

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            Back to dashboard
          </Link>
        </div>

        {error.digest ? (
          // Shown because it is the one piece of the error that is safe and genuinely useful when
          // reporting a problem: it ties this render to a server log entry without exposing code.
          <p className="mt-6 text-center text-meta text-ink-muted">
            Reference: <span className="tabular">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
