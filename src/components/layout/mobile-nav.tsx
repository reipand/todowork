'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import { NAV_ITEMS } from '@/components/layout/navigation';
import { TodoworkMark } from '@/components/layout/sidebar';
import { MOBILE_NAV_ITEMS } from '@/components/layout/navigation';
import { cn } from '@/lib/utils';

/**
 * Mobile navigation.
 *
 * Two affordances, because one cannot cover both needs:
 *   - A bottom bar for the five destinations a person uses constantly. Reachable one-handed with the
 *     thumb, which is the entire reason to put them at the bottom rather than the top.
 *   - A drawer for everything else, so no destination is unreachable on a phone.
 *
 * The bottom bar respects `env(safe-area-inset-bottom)`, so on a notched device the labels do not sit
 * under the home indicator. Tap targets are the full 3.75rem bar height, comfortably above the 44px
 * minimum.
 */

export interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNavDrawer({ open, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close on Escape and trap nothing: the drawer is a navigation affordance, so leaving the page
  // underneath scrollable is harmless, but Escape must still dismiss it.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    // Focus the close button so a keyboard or screen-reader user lands inside the drawer rather than
    // at the top of the page behind it.
    closeButtonRef.current?.focus();

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Lock background scroll while open, so a swipe does not scroll the page behind the drawer.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Scrim. A click dismisses, and it is aria-hidden because it is purely a visual affordance
          with an equivalent keyboard path (Escape, or the close button). */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface pt-safe pb-safe"
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-2">
            <TodoworkMark />
            <span className="text-body font-semibold tracking-tight text-ink">Todowork</span>
          </Link>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="flex h-9 w-9 items-center justify-center rounded-control text-ink-muted transition-colors duration-hover hover:bg-sunken hover:text-ink"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex h-11 items-center gap-3 rounded-control px-3 text-body transition-colors duration-hover',
                    isActive
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-ink-secondary hover:bg-sunken hover:text-ink',
                  )}
                >
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * Bottom navigation bar.
 *
 * Hidden from `lg` up, where the sidebar takes over. `aria-current="page"` marks the active item so a
 * screen reader announces it rather than leaving the user to infer it from styling.
 */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-safe lg:hidden"
    >
      <ul className="flex h-bottom-nav items-stretch">
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-0.5 text-[0.6875rem] transition-colors duration-hover',
                  isActive ? 'font-medium text-accent' : 'text-ink-muted hover:text-ink',
                )}
              >
                <Icon aria-hidden="true" className="h-5 w-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
