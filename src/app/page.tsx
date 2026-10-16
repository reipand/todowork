'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useSession } from '@/features/auth/session-context';

/**
 * The root route — the app's front door.
 *
 * Decides where to send a visitor based on their session status:
 *   - authenticated → /dashboard (straight to work)
 *   - anonymous     → /sign-in (login is the first thing a new visitor sees)
 *   - loading       → hold (brief, while the local session is read)
 *
 * This is a client component because session status is a runtime value, not known at build time in
 * a static export. The trade-off vs a server redirect is one frame of a loading spinner before
 * hydration — acceptable, because the alternative (a server redirect to a fixed destination) cannot
 * be conditional on auth state.
 *
 * A signed-in user who opens the app goes straight to their dashboard. A new visitor sees the
 * sign-in page first, and can either sign in or click "Continue as guest" to reach the dashboard
 * without an account.
 */
export default function RootPage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    } else if (status === 'anonymous') {
      router.replace('/sign-in');
    }
  }, [status, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent"
        aria-hidden="true"
      />
      <span className="sr-only" aria-live="polite">
        Loading…
      </span>
    </div>
  );
}
