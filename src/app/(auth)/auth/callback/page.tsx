import { Suspense } from 'react';

import { AuthCallbackClient } from './callback-client';

/**
 * Auth callback.
 *
 * The Supabase client processes the auth tokens in the URL via `detectSessionInUrl` on init. This
 * page's job is to wait for that processing to settle, then redirect to the `next` query param (set
 * by `requestPasswordReset` to `/reset-password`) or to the dashboard.
 *
 * The Suspense boundary is required because `useSearchParams` in a static export must be wrapped,
 * or the build fails.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-3 py-10">
          <div
            className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent"
            aria-hidden="true"
          />
          <p className="text-body text-ink-secondary" aria-live="polite">
            Finishing sign-in…
          </p>
        </div>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
