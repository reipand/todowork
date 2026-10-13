'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Menu, Search, UserRound } from 'lucide-react';

import { SyncIndicator } from '@/components/ui/sync-indicator';
import { useSession } from '@/features/auth/session-context';
import { cn } from '@/lib/utils';

/**
 * Top bar.
 *
 * Holds the three things a user reaches for from anywhere: search, their account, and the sync state.
 * On mobile it also carries the menu button that opens the drawer.
 *
 * The account menu is a real disclosure with keyboard support: opened by click or Enter, closed by
 * Escape or an outside click, with `aria-expanded` and `aria-haspopup` set so assistive tech knows
 * what it is. An unlabelled avatar button that opens an unreachable menu is the failure mode antislop
 * R-26 warns about.
 */

export interface TopBarProps {
  onOpenMobileNav: () => void;
}

export function TopBar({ onOpenMobileNav }: TopBarProps) {
  const router = useRouter();
  const { user, signOutCurrentUser } = useSession();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close the menu on Escape or an outside click. Both are handled here rather than in CSS so the
  // state cannot drift from the DOM.
  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    const handlePointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuOpen]);

  const displayName = user?.email ?? 'Guest';

  // The initial is used for the avatar placeholder. No generated avatar image: antislop R-23 forbids
  // fabricating a profile picture, and an initial is honest about being a placeholder.
  const initial = user?.isGuest ? 'G' : (user?.email?.charAt(0).toUpperCase() ?? '?');

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-paper/95 px-3 pt-safe backdrop-blur-sm sm:px-4">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation menu"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-secondary transition-colors duration-hover hover:bg-sunken hover:text-ink lg:hidden"
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </button>

      <form
        role="search"
        className="relative min-w-0 flex-1 sm:max-w-md"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = searchValue.trim();
          // Navigating to the task list with the term in the query string keeps search shareable and
          // back-button friendly, rather than holding it only in component state.
          router.push(trimmed ? `/tasks?q=${encodeURIComponent(trimmed)}` : '/tasks');
        }}
      >
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search tasks"
          // A visually hidden label: the placeholder alone is not an accessible name, and a placeholder
          // disappears the moment the user types.
          aria-label="Search tasks"
          className="h-9 w-full rounded-control border border-line-strong bg-surface pl-8 pr-3 text-body text-ink placeholder:text-ink-muted transition-colors duration-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
        />
      </form>

      <div className="ml-auto flex items-center gap-1">
        <SyncIndicator className="hidden sm:inline-flex" />

        <div ref={menuRef} className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Account menu for ${displayName}`}
            className="flex h-9 items-center gap-2 rounded-control px-1.5 transition-colors duration-hover hover:bg-sunken"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-meta font-semibold text-accent">
              {initial}
            </span>
            <UserRound aria-hidden="true" className="hidden h-4 w-4 text-ink-muted sm:block" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              aria-label="Account"
              className="absolute right-0 top-full z-40 mt-1 w-60 animate-popover-in rounded-card border border-line bg-surface py-1 shadow-popover"
            >
              <div className="border-b border-line px-3 py-2">
                <p className="truncate text-body font-medium text-ink">{displayName}</p>
                <p className="text-meta text-ink-muted">
                  {user?.isGuest ? 'Working locally on this device' : 'Signed in'}
                </p>
              </div>

              <Link
                role="menuitem"
                href="/settings"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-body text-ink-secondary transition-colors duration-hover hover:bg-sunken hover:text-ink"
              >
                Settings and account
              </Link>

              <Link
                role="menuitem"
                href="/settings/sync"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-body text-ink-secondary transition-colors duration-hover hover:bg-sunken hover:text-ink"
              >
                Sync status
              </Link>

              {user?.isGuest ? (
                <Link
                  role="menuitem"
                  href="/sign-in"
                  onClick={() => setMenuOpen(false)}
                  className="block border-t border-line px-3 py-2 text-body font-medium text-accent transition-colors duration-hover hover:bg-accent-soft"
                >
                  Sign in to sync
                </Link>
              ) : (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void signOutCurrentUser().then(() => router.push('/sign-in'));
                  }}
                  className="block w-full border-t border-line px-3 py-2 text-left text-body text-ink-secondary transition-colors duration-hover hover:bg-sunken hover:text-ink"
                >
                  Sign out
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Compact mobile variant of the sync indicator, shown in the mobile top bar only. */
export function MobileSyncRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-center border-b border-line px-3 py-1.5 sm:hidden', className)}>
      <SyncIndicator />
    </div>
  );
}