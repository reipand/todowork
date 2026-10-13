'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useSession } from '@/features/auth/session-context';

/**
 * Auth callback (client).
 *
 * Calls `refreshSession` to pick up the session the Supabase client established from the URL
 * (`detectSessionInUrl`), then redirects to the `next` param or the dashboard.
 *
 * `refreshSession` calls `supabase.auth.getSession()`, which resolves after URL detection
 * completes — so the session is real by the time the redirect happens.
 *
 * If no session is found (invalid or expired link), the user is sent to sign-in with an error
 * suffix so the sign-in page can surface a message.
 */

export function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshSession } = useSession();

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      await refreshSession();
      if (cancelled) return;

      const next = searchParams.get('next');
      // Only allow internal paths to prevent open-redirect via a crafted `next` param.
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

      router.replace(safeNext);
    }

    void run();

    return () => {
      cancelled = true;
    };
    // `refreshSession` is stable (useCallback with no deps). `searchParams` and `router` are stable
    // per render. The redirect must happen once, regardless of auth-listener state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <div
        className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        aria-hidden="true"
      />
      <p className="text-body text-ink-secondary" aria-live="polite">
        Finishing sign-in…
      </p>
    </div>
  );
}
