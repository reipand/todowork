'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';

import { getSupabaseClient, isCloudConfigured } from '@/lib/supabase/client';
import { sync } from '@/features/sync/engine';

/**
 * Sync triggers.
 *
 * The spec requires sync to run when the app opens, when connectivity returns, when the app becomes
 * active, and on manual request. All four funnel through here so there is one place that decides
 * when a sync is warranted, instead of each page calling `sync()` on its own and producing a storm
 * of overlapping runs.
 *
 * Every trigger is deliberately debounced or guarded, because the underlying events fire more often
 * than a human would expect. A phone switching between Wi-Fi and cellular can emit several
 * connectivity events in a second, and a user alt-tabbing fires `visibilitychange` every time.
 */

export interface SyncTriggerOptions {
  userId: string | null;
  deviceId: string;
  /** Disables automatic triggers while a conflict is awaiting resolution. */
  paused?: boolean;
  /** Periodic backstop interval, in milliseconds. */
  intervalMs?: number;
}

export function useSyncTriggers(options: SyncTriggerOptions): void {
  const { userId, deviceId, paused = false, intervalMs = 30 * 1000 } = options;

  // Tracks the last trigger so rapid duplicate events collapse into one run.
  const lastTriggerRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!userId || paused) return;

    // A fresh controller per effect run, so an account switch aborts the previous account's sync
    // rather than letting it write rows under the wrong user id.
    const controller = new AbortController();
    abortRef.current = controller;

    const runSync = (reason: string): void => {
      const now = Date.now();
      // 500ms collapse window. Long enough to absorb an event burst, short enough that a
      // realtime push from another device feels instant.
      if (now - lastTriggerRef.current < 500) return;
      lastTriggerRef.current = now;

      void sync({
        userId,
        deviceId,
        signal: controller.signal,
        onProgress: () => {
          // Progress is read from Dexie by the indicator, so nothing to do here beyond allowing the
          // engine to report. Kept as an explicit no-op with this comment so its absence is not
          // mistaken for an oversight.
        },
      }).catch((error: unknown) => {
        // A failed sync is expected and recoverable: the queue is durable, so the next trigger
        // retries. Swallowing is correct here, but it is not silent: the Sync Status screen and the
        // indicator both read failure state from Dexie, which the engine writes.
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[sync] trigger "${reason}" did not complete:`, error);
        }
      });
    };

    // Trigger 1: app opened. Runs once on mount.
    runSync('mount');

    // Trigger 2: connectivity returned.
    const handleOnline = (): void => runSync('online');
    window.addEventListener('online', handleOnline);

    // Trigger 3: app became active. Guarded on visibilityState so a tab that is hidden does not
    // sync, which would waste battery and bandwidth on a backgrounded page.
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') runSync('visibility');
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Trigger 3b: window focus. Catches cases where visibilitychange does not fire but the user
    // clicked back into the PWA window.
    const handleFocus = (): void => runSync('focus');
    window.addEventListener('focus', handleFocus);

    // Trigger 4: periodic backstop. Exists because a device can hold stale data with no event to
    // announce it: another device may have changed something while this one sat idle and online.
    // 30 seconds keeps cross-device freshness high without hammering the API from every open tab.
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') runSync('interval');
    }, intervalMs);

    // Trigger 5: Supabase Realtime push. When another device pushes a change to the database,
    // Supabase broadcasts a postgres_changes event over a websocket. This gives near-instant
    // cross-device sync: Device B learns about Device A's edit in milliseconds, not on the next
    // 5-minute interval. RLS policies ensure each user only receives events for their own rows,
    // so no filter is needed on the subscription.
    //
    // The 2-second debounce on `runSync` collapses event bursts (a single edit can fire multiple
    // events) into one sync run. The pull is idempotent — rows already at the current cursor are
    // not refetched — so a self-triggered event (Device A receiving its own push echo) is a no-op.
    const supabase = isCloudConfigured() ? getSupabaseClient() : null;
    let channel: RealtimeChannel | null = null;
    if (supabase) {
      channel = supabase
        .channel('sync-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => runSync('realtime'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_subtasks' }, () => runSync('realtime'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => runSync('realtime'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tags' }, () => runSync('realtime'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_tags' }, () => runSync('realtime'))
        .subscribe();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
      // Abort on unmount or account change so a run cannot complete against a stale user id.
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [userId, deviceId, paused, intervalMs]);
}

/** True when the browser reports an active connection. */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
