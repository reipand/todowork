'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useState } from 'react';

import { getDatabase } from '@/lib/db/schema';
import { sync, retryFailedMutations } from '@/features/sync/engine';
import { useSession } from '@/features/auth/session-context';
import { useOnlineStatus } from '@/hooks/use-sync-triggers';
import { cn } from '@/lib/utils';
import type { SyncPhase } from '@/types/domain';

/**
 * Sync status indicator.
 *
 * Every number rendered here is read from Dexie and reflects real queue state. Nothing is guessed and
 * nothing is optimistic: a mutation counts as synced only once the engine has removed it after a
 * server confirmation.
 *
 * The phases are deliberately distinct rather than collapsing into a spinner:
 *   offline  - no connection; local work is queued and safe
 *   syncing  - a run is in progress
 *   pending  - queued work exists but no run is active
 *   conflict - a concurrent edit needs the user's decision
 *   error    - a mutation was rejected or exhausted its retries
 *
 * Distinguishing "offline with queued work" from "error" matters: the first is normal and needs no
 * action, the second needs the user to do something. Showing one spinner for both would train people
 * to ignore it.
 */

export function useSyncStatus(): {
  phase: SyncPhase;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  triggerSync: () => Promise<void>;
  retryFailed: () => Promise<void>;
  isSyncing: boolean;
} {
  const { user, status: sessionStatus } = useSession();
  const isOnline = useOnlineStatus();
  const [isSyncing, setIsSyncing] = useState(false);

  const userId = user?.id ?? null;
  const isCloud = sessionStatus === 'authenticated' && user !== null && !user.isGuest;

  // A live query, so the counts update the moment the engine changes the queue.
  const counts = useLiveQuery(
    async () => {
      if (!userId || !isCloud) {
        return { pending: 0, failed: 0, conflicts: 0, lastPulledAt: null as string | null };
      }

      const db = getDatabase();

      const [pending, failed, allConflicts, meta] = await Promise.all([
        db.mutations.where('[user_id+status]').equals([userId, 'pending']).count(),
        db.mutations.where('[user_id+status]').equals([userId, 'failed']).count(),
        db.conflicts.where('user_id').equals(userId).toArray(),
        db.syncMeta.get(`sync-meta:${userId}`),
      ]);

      return {
        pending,
        failed,
        conflicts: allConflicts.filter((conflict) => conflict.resolved_at === null).length,
        lastPulledAt: meta?.last_pulled_at ?? null,
      };
    },
    [userId, isCloud],
    { pending: 0, failed: 0, conflicts: 0, lastPulledAt: null as string | null },
  );

  const triggerSync = useCallback(async () => {
    if (!userId || !isCloud || !isOnline) return;

    setIsSyncing(true);
    try {
      // The engine joins an existing run rather than starting a second one, so a double tap here is
      // harmless.
      await sync({ userId, deviceId: readDeviceId() });
    } catch {
      // Failure state is already durable in Dexie (the queue holds the retry), so the indicator will
      // reflect it on the next live-query tick. No separate error state is needed here.
    } finally {
      setIsSyncing(false);
    }
  }, [userId, isCloud, isOnline]);

  const retryFailed = useCallback(async () => {
    if (!userId) return;
    await retryFailedMutations(userId);
    await triggerSync();
  }, [userId, triggerSync]);

  const phase: SyncPhase = (() => {
    if (!isCloud) return 'idle';
    if (counts.conflicts > 0) return 'conflict';
    if (counts.failed > 0) return 'error';
    if (!isOnline) return 'offline';
    if (isSyncing) return 'syncing';
    if (counts.pending > 0) return 'pending';
    return 'idle';
  })();

  return {
    phase,
    pendingCount: counts.pending,
    failedCount: counts.failed,
    conflictCount: counts.conflicts,
    lastSyncedAt: counts.lastPulledAt,
    triggerSync,
    retryFailed,
    isSyncing,
  };
}

/**
 * Reads the device id directly from storage.
 *
 * Duplicated from the session provider rather than threaded through context, because the indicator
 * needs it during a user-triggered sync and reading one string is cheaper than widening the session
 * context's surface for every consumer.
 */
function readDeviceId(): string {
  try {
    return window.localStorage.getItem('todowork.device.id') ?? 'unknown-device';
  } catch {
    return 'unknown-device';
  }
}

/**
 * Compact indicator for the top bar.
 *
 * Text plus a shape, never colour alone. The dot's shape differs per phase so the state survives
 * monochrome and colour-vision deficiency: filled for active problems, hollow for benign, ring for
 * in-progress.
 */
export function SyncIndicator({ className }: { className?: string }) {
  const { phase, pendingCount, failedCount, conflictCount, triggerSync, isSyncing } = useSyncStatus();

  const label = describePhase(phase, { pendingCount, failedCount, conflictCount });

  return (
    <button
      type="button"
      onClick={() => void triggerSync()}
      disabled={phase === 'offline' || phase === 'idle'}
      // The visible text is short; the full description goes in the accessible name so a screen
      // reader gets the count and the meaning, not just "Synced".
      aria-label={`${label}. ${phase === 'offline' || phase === 'idle' ? '' : 'Activate to sync now.'}`}
      title={label}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-control px-2 text-meta font-medium transition-colors duration-hover',
        phase === 'offline' || phase === 'idle'
          ? 'cursor-default text-ink-muted'
          : 'text-ink-secondary hover:bg-sunken hover:text-ink',
        className,
      )}
    >
      <SyncGlyph phase={phase} isSyncing={isSyncing} />
      <span>{label}</span>
    </button>
  );
}

/**
 * Phase glyph.
 *
 * Each phase gets a distinct shape, not merely a distinct colour, so the indicator is readable
 * without colour perception.
 */
function SyncGlyph({ phase, isSyncing }: { phase: SyncPhase; isSyncing: boolean }) {
  if (phase === 'syncing' || isSyncing) {
    return (
      <span
        aria-hidden="true"
        className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
    );
  }

  // Offline uses a slashed circle, error a filled square, conflict a filled triangle, pending a
  // hollow ring, and idle a plain dot. Five distinguishable silhouettes at 12px.
  if (phase === 'offline') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3.5 w-3.5">
        <circle cx="12" cy="12" r="9" strokeWidth="1.75" />
        <path d="M6 18 18 6" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }

  if (phase === 'error') {
    return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-danger" />;
  }

  if (phase === 'conflict') {
    return (
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-warning">
        <path d="M6 1 11 10.5H1z" />
      </svg>
    );
  }

  if (phase === 'pending') {
    return (
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-2 border-ink-muted" />
    );
  }

  return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-success" />;
}

function describePhase(
  phase: SyncPhase,
  counts: { pendingCount: number; failedCount: number; conflictCount: number },
): string {
  switch (phase) {
    case 'offline':
      return counts.pendingCount > 0
        ? `Offline, ${counts.pendingCount} waiting`
        : 'Offline';
    case 'syncing':
      return 'Syncing';
    case 'pending':
      return `${counts.pendingCount} waiting to sync`;
    case 'conflict':
      return counts.conflictCount === 1
        ? '1 conflict to resolve'
        : `${counts.conflictCount} conflicts to resolve`;
    case 'error':
      return counts.failedCount === 1 ? '1 change failed' : `${counts.failedCount} changes failed`;
    case 'idle':
    default:
      return 'Synced';
  }
}
