'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { TodoworkMark } from '@/components/layout/sidebar';
import { useSession } from '@/features/auth/session-context';

/**
 * Auth layout.
 *
 * A bare, centered shell with only the wordmark — no sidebar, no bottom nav. The auth routes are the
 * only place in the app where a user has no data to navigate to, so the chrome would be noise.
 *
 * A signed-in user is redirected to the dashboard — except on `/auth/callback`, which handles its
 * own redirect based on the `next` query param (password recovery routes there, not to the
 * dashboard). Waiting for `status` to settle avoids bouncing a user whose session is still being
 * restored from the local store.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    // The callback page reads `?next=` and redirects itself. A blanket redirect here would race
    // with it and send a recovery user to the dashboard instead of the reset screen.
    if (pathname === '/auth/callback/') return;
    router.replace('/dashboard');
  }, [status, pathname, router]);

  // While loading, render nothing: a flash of the auth form before a redirect would be confusing.
  if (status === 'loading') return null;

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <Link
        href="/"
        className="mb-8 inline-flex items-center text-title font-semibold text-ink transition-colors duration-hover hover:text-accent"
        aria-label="Todowork home"
      >
        <TodoworkMark />
      </Link>

      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
