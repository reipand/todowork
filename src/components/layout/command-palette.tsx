'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { Moon, Plus, Search, Sun, type LucideIcon } from 'lucide-react';

import { NAV_ITEMS } from '@/components/layout/navigation';
import { getDatabase, liveRowsFor } from '@/lib/db/schema';
import { useActiveUserId } from '@/features/auth/session-context';
import { useTheme } from '@/features/settings/theme-context';
import { cn } from '@/lib/utils';

/**
 * Command Palette.
 *
 * A Cmd+K / Ctrl+K quick switcher inspired by Notion's command palette. Three groups:
 *   - Navigate: jump to any dashboard route
 *   - Actions: create a task, toggle theme
 *   - Tasks: fuzzy-search task titles (only shown when there is a query)
 *
 * Built on the native `<dialog>` element — same pattern as Dialog — for focus trapping,
 * top-layer rendering, and Escape-to-close. The layout is custom (search input + scrollable
 * results) rather than reusing Dialog's title/body/footer structure.
 *
 * Fuzzy matching is a simple case-insensitive substring match with position scoring. No
 * external dependency: the palette caps at 12 results, and a linear scan of ~100 task titles
 * is sub-millisecond.
 */

// --- Fuzzy match -------------------------------------------------------------

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const idx = t.indexOf(q);
  if (idx !== -1) return 100 - idx; // earlier substring match wins
  // Loose character-by-character match for typo tolerance
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? qi * 2 : 0;
}

// --- Types -------------------------------------------------------------------

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: 'Navigate' | 'Actions' | 'Tasks';
  score: number;
  action: () => void;
}

const GROUP_ORDER = ['Navigate', 'Actions', 'Tasks'] as const;
const GROUP_LABELS: Record<string, string> = {
  Navigate: 'Go to',
  Actions: 'Actions',
  Tasks: 'Tasks',
};

// --- Component ---------------------------------------------------------------

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const userId = useActiveUserId();
  const { resolved, setPreference } = useTheme();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch task titles once and keep them live; filter in memory by query.
  // Avoids a DB round-trip per keystroke — the subscription is lightweight and keeps
  // results fresh when a task is added or completed from another tab.
  const taskTitles = useLiveQuery(
    async () => {
      const db = getDatabase();
      const tasks = await liveRowsFor(db.tasks, userId);
      return tasks
        .filter((t) => !t.completed)
        .map((t) => ({ id: t.id, title: t.title }))
        .slice(0, 100);
    },
    [userId],
    [],
  );

  // Build, filter, and score all items.
  const items = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = NAV_ITEMS.map((item) => ({
      id: `nav-${item.href}`,
      label: item.label,
      hint: item.href,
      icon: item.icon,
      group: 'Navigate',
      score: fuzzyScore(query, item.label) + fuzzyScore(query, item.description) * 0.3,
      action: () => {
        router.push(item.href);
        onClose();
      },
    }));

    const actions: CommandItem[] = [
      {
        id: 'action-new-task',
        label: 'New Task',
        hint: 'Go to tasks',
        icon: Plus,
        group: 'Actions',
        score: fuzzyScore(query, 'New Task') + fuzzyScore(query, 'Create task') * 0.5,
        action: () => {
          router.push('/tasks');
          onClose();
        },
      },
      {
        id: 'action-theme',
        label: resolved === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
        hint: 'Appearance',
        icon: resolved === 'dark' ? Sun : Moon,
        group: 'Actions',
        score: fuzzyScore(query, 'theme') + fuzzyScore(query, 'dark') + fuzzyScore(query, 'light'),
        action: () => {
          setPreference(resolved === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
    ];

    const tasks: CommandItem[] = (taskTitles ?? []).map((t) => ({
      id: `task-${t.id}`,
      label: t.title,
      hint: 'Open task',
      icon: Search,
      group: 'Tasks',
      score: fuzzyScore(query, t.title),
      action: () => {
        router.push('/tasks');
        onClose();
      },
    }));

    const all = [...nav, ...actions, ...tasks];
    // No query: show nav + actions, hide tasks (would be 100 random tasks).
    const filtered = query
      ? all.filter((i) => i.score > 0)
      : all.filter((i) => i.group !== 'Tasks');
    return filtered.sort((a, b) => b.score - a.score).slice(0, 12);
  }, [query, taskTitles, router, onClose, resolved, setPreference]);

  // Reset selection when results change.
  useEffect(() => setSelected(0), [items]);

  // Dialog show/hide + scroll lock.
  // The overflow is reset in the effect rather than only in the else-branch, because native
  // Escape closes the dialog before React state updates — the else-branch would miss it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open) document.body.style.overflow = '';
  }, [open]);

  // Clear query when closed so the palette opens fresh each time.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Scroll the selected item into view during keyboard navigation.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-index="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Group items for rendering with section headers.
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of items) {
      const arr = map.get(item.group) ?? [];
      arr.push(item);
      map.set(item.group, arr);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      items: map.get(g)!,
    }));
  }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[selected]?.action();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="w-full max-w-lg border border-line bg-surface p-0 rounded-panel backdrop:bg-black/40 dark:backdrop:bg-black/60"
      style={{ maxHeight: '70dvh' }}
      aria-label="Command palette"
    >
      <div className="flex flex-col max-h-[inherit]">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages and actions…"
            aria-label="Search pages and actions"
            className="flex-1 bg-transparent text-body text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-meta text-ink-muted">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-body text-ink-muted">
              {query ? `No results for "${query}"` : 'Start typing to search…'}
            </p>
          ) : (
            grouped.map(({ group, items: groupItems }) => (
              <div key={group} className="mb-1 last:mb-0">
                <p className="px-3 py-1.5 text-meta font-medium uppercase tracking-wide text-ink-muted">
                  {GROUP_LABELS[group] ?? group}
                </p>
                {groupItems.map((item) => {
                  const idx = items.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      data-index={idx}
                      type="button"
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => item.action()}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-control px-3 py-2 text-body transition-colors duration-hover',
                        idx === selected
                          ? 'bg-accent-soft text-accent'
                          : 'text-ink hover:bg-sunken',
                      )}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {item.hint ? (
                        <span className="shrink-0 text-meta text-ink-muted">{item.hint}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </dialog>
  );
}
