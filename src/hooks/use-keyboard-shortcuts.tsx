'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Keyboard } from 'lucide-react';

import { Dialog } from '@/components/ui/dialog';

/**
 * Keyboard shortcuts.
 *
 * Registered on window so they work from anywhere in the dashboard. Shortcuts are
 * suppressed while focus is in an editable element (input, textarea, select,
 * contenteditable) so typing a literal "n" into a task title does not navigate.
 *
 * Cmd+K / Ctrl+K is handled separately in DashboardShell (command palette).
 */

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function useKeyboardShortcuts(): {
  showHelp: boolean;
  setShowHelp: (open: boolean) => void;
} {
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  const handler = useCallback(
    (event: KeyboardEvent) => {
      // Let Cmd/Ctrl combos pass through — they're handled elsewhere (Cmd+K, Cmd+S, etc.)
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event)) return;

      switch (event.key.toLowerCase()) {
        case 'n':
          event.preventDefault();
          router.push('/tasks');
          // Focus the quick-add input after navigation settles.
          setTimeout(() => window.dispatchEvent(new CustomEvent('todowork:focus-quick-add')), 100);
          break;

        case '?':
          event.preventDefault();
          setShowHelp((prev) => !prev);
          break;
      }
    },
    [router],
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);

  return { showHelp, setShowHelp };
}

/** Shortcuts help dialog content. */
const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: '⌘K', action: 'Open command palette' },
  { keys: 'N', action: 'New task' },
  { keys: '?', action: 'Show this help' },
  { keys: 'Esc', action: 'Close dialog or panel' },
];

/** Mac detection for display label. */
function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);
  return isMac;
}

export function ShortcutsHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isMac = useIsMac();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Speed up your workflow without reaching for the mouse."
    >
      <ul className="flex flex-col gap-1 py-2">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between gap-4 px-1 py-1.5">
            <span className="text-body text-ink-secondary">{s.action}</span>
            <kbd className="shrink-0 rounded border border-line bg-surface px-2 py-0.5 text-meta font-medium text-ink-muted">
              {isMac ? s.keys : s.keys.replace('⌘', 'Ctrl')}
            </kbd>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-meta text-ink-muted">
        <Keyboard aria-hidden="true" className="h-3.5 w-3.5" />
        <span>Tip: type dates and priorities when adding a task — {'"'}meeting tomorrow #high{'"'}</span>
      </div>
    </Dialog>
  );
}
