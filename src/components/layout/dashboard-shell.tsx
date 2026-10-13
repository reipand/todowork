'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { CommandPalette } from '@/components/layout/command-palette';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar, MobileSyncRow } from '@/components/layout/top-bar';
import { MobileBottomNav, MobileNavDrawer } from '@/components/layout/mobile-nav';
import { useDatabaseReady, useSession } from '@/features/auth/session-context';
import { StatsSkeleton } from '@/components/ui/states';
import { ShortcutsHelpDialog, useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

/**
 * Dashboard shell.
 *
 * Owns the chrome that every authenticated page shares, and gates rendering on two asynchronous
 * facts: the local database being open, and the session being resolved. Rendering the routes before
 * either is known would flash an empty state at a user who actually has data, or briefly show the
 * guest view to a signed-in user.
 *
 * The sidebar's collapsed state is persisted per device. `localStorage` is correct for this: it is a
 * UI preference, not application data, so it does not violate the "no localStorage as primary store"
 * rule that applies to tasks.
 */

const SIDEBAR_STORAGE_KEY = 'todowork.sidebar.collapsed';

export interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const { status } = useSession();
  const databaseReady = useDatabaseReady();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { showHelp: showShortcutsHelp, setShowHelp: setShowShortcutsHelp } = useKeyboardShortcuts();

  // Cmd+K / Ctrl+K toggles the command palette. Registered on window so it works regardless of
  // focus location — the user can be in the sidebar, the task list, or the detail panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Read the persisted preference after mount. Reading it during render would produce a hydration
  // mismatch, because the static HTML is generated without access to storage.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true');
    } catch {
      // Storage unavailable: the default (expanded) is a fine fallback and needs no messaging.
    }
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Non-fatal: the preference simply will not persist across reloads.
      }
      return next;
    });
  };

  // Session still resolving, or the database still opening. A skeleton rather than a spinner, so the
  // layout does not jump when content arrives.
  if (status === 'loading' || !databaseReady) {
    return (
      <div className="flex min-h-dvh flex-col">
        <div className="h-14 border-b border-line bg-paper" />
        <div className="mx-auto w-full max-w-4xl p-6">
          <StatsSkeleton />
        </div>
        {/* Announce the wait so a screen reader is not left in silence during a slow storage open. */}
        <p role="status" className="sr-only">
          Loading your workspace
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-paper">
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />

      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <MobileSyncRow />

        {/*
          The bottom padding clears the fixed mobile bar, including its safe-area inset, so the last
          task row is never trapped underneath it.
        */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pb-[calc(theme(spacing.bottom-nav)+env(safe-area-inset-bottom,0px))] lg:pb-0"
        >
          {children}
        </main>
      </div>

      <MobileBottomNav />

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      <ShortcutsHelpDialog open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />
    </div>
  );
}
