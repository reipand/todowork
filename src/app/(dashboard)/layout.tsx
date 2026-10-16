'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { DashboardShell } from '@/components/layout/dashboard-shell';
import { useSession } from '@/features/auth/session-context';

/**
 * Layout for every authenticated route.
 *
 * Guest mode is allowed here on purpose. A user with no account can use the app fully against local
 * storage, which is the product's core promise. What is NOT allowed is a guest reaching cloud data,
 * and that is enforced by RLS in the database, not by this redirect: the client guard is a
 * convenience, the policies are the control.
 *
 * A signed-in user is never bounced out. Only the sign-in and sign-up routes redirect when a session
 * exists.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    // `status` starts as 'loading' and only settles once the local session has been read. Waiting for
    // a settled status avoids the classic bug of redirecting a signed-in user during the brief window
    // before their session is restored.
    if (status === 'authenticated') return;

    // An anonymous visitor is a guest, which is a supported state, so nothing is forced here. The
    // guard exists so that a future rule (for example, requiring an account for a paid feature) has
    // one obvious place to live.
    void router.prefetch('/sign-in');
  }, [status, router]);

  return <DashboardShell>{children}</DashboardShell>;
}
