'use client';

import type { ReactNode } from 'react';

import { ThemeProvider } from '@/features/settings/theme-context';
import { SessionProvider } from '@/features/auth/session-context';
import { ToastProvider } from '@/components/ui/toast';

/**
 * Client-side provider stack.
 *
 * Ordering is deliberate:
 *   1. ThemeProvider first, so the theme class is applied before any themed component renders and
 *      there is no flash of the wrong theme on a client-side navigation.
 *   2. SessionProvider second, because it decides which account the rest of the tree is scoped to.
 *      Every data hook below it depends on that id.
 *   3. ToastProvider last, so a toast raised during a session change still has a host to render into.
 *
 * Kept as its own client component so the root layout can stay a server component. A static export
 * still benefits from that split: the layout's metadata and font setup are resolved at build time.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
