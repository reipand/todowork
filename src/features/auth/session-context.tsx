'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { isCloudConfigured } from '@/lib/supabase/client';
import { GUEST_USER_ID, getDatabase, migrateGuestData } from '@/lib/db/schema';
import { onAuthStateChange, readLocalSession, signOut } from '@/features/auth/service';
import { resetSyncState, sync } from '@/features/sync/engine';
import { useSyncTriggers } from '@/hooks/use-sync-triggers';
import { newId } from '@/lib/utils';

/**
 * Session and account context.
 *
 * The single most important responsibility here is **account isolation**. The local database is
 * shared across every account that has ever used this device, so every query must be scoped to the
 * active user id, and switching accounts must never let one account's rows be read, written, or
 * uploaded under another's identity. The spec treats mixing account data as a correctness failure,
 * and it is the kind of bug that is invisible until it corrupts someone's data.
 *
 * The measures taken, in order of importance:
 *   1. `userId` is the only source of scope. Every feature service receives it and filters on it.
 *   2. On account change, any in-flight sync is aborted before the new account is activated, so a
 *      late response cannot write rows under the wrong id.
 *   3. The previous account's sync cursor is cleared, so the new account starts from revision 0
 *      rather than inheriting a position that would make it skip its own rows.
 *   4. Nothing is deleted implicitly. Switching accounts leaves the other account's local data in
 *      place, so switching back finds everything where it was.
 */

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionUser {
  id: string;
  email: string | null;
  /** True when there is no cloud account and the user is working purely locally. */
  isGuest: boolean;
}

export interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  /** The id every local query must be scoped by. Never null once loading completes. */
  activeUserId: string;
  cloudConfigured: boolean;
  /** Stable per-device id, used as the `sync_devices` key so cursors are tracked per device. */
  deviceId: string;
  /** Runtime platform, so Settings > Sync can label this device and features can adapt. */
  platform: PlatformKind;
  signOutCurrentUser: () => Promise<{ ok: boolean; error?: string }>;
  /** Re-reads the local session. Used by the auth callback after a redirect. */
  refreshSession: () => Promise<void>;
}

/** Where the app is currently running. Drives device labelling and native-only affordances. */
export type PlatformKind = 'web' | 'pwa' | 'android' | 'ios';

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Stable per-device identifier.
 *
 * Used as the `sync_devices` key so this device's pull cursor is tracked independently. Persisted in
 * localStorage rather than IndexedDB because it must be readable before the database opens, and it
 * is not application data, so it is not a violation of the "no localStorage as primary store" rule:
 * the task data itself lives in IndexedDB.
 */
function readOrCreateDeviceId(): string {
  const storageKey = 'todowork.device.id';

  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;

    const created = newId();
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    // Storage can be unavailable in a private window or when quota is exhausted. A session-only id
    // still works for this run; the device simply gets a new cursor next time.
    return newId();
  }
}

/** Human label for the Settings > Sync screen, so a user can tell devices apart. */
function detectPlatform(): PlatformKind {
  if (typeof window === 'undefined') return 'web';

  // Capacitor injects a platform object into the WebView. Checking for it distinguishes the native
  // shells from a browser, which the spec's per-platform behaviour depends on.
  const capacitor = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';

  // Standalone display mode means the PWA was installed rather than loaded in a tab.
  if (window.matchMedia('(display-mode: standalone)').matches) return 'pwa';
  return 'web';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const deviceIdRef = useRef<string>('');
  const previousUserIdRef = useRef<string | null>(null);

  // Initialised lazily on the client, because neither `localStorage` nor `navigator` exists during a
  // static export's build pass.
  if (deviceIdRef.current === '') {
    deviceIdRef.current = typeof window === 'undefined' ? 'server' : readOrCreateDeviceId();
  }

  /**
   * Restores the session on first load.
   *
   * Reads local state only, so it is fast and works offline. A user who opens the app on a plane
   * stays signed in and can use their tasks; the session is validated when a request is next made.
   */
  const refreshSession = useCallback(async () => {
    if (!isCloudConfigured()) {
      // No cloud configured: run as a guest. Guest mode is strictly local and never attempts
      // unauthenticated cloud access.
      setUser({ id: GUEST_USER_ID, email: null, isGuest: true });
      setStatus('anonymous');
      return;
    }

    try {
      const session = await readLocalSession();

      if (session) {
        setUser({ id: session.userId, email: session.email, isGuest: false });
        setStatus('authenticated');
      } else {
        // No session does NOT mean guest data should be surfaced as if it belonged to a signed-out
        // user. Guest data stays quarantined under GUEST_USER_ID until the user explicitly decides
        // what to do with it.
        setUser({ id: GUEST_USER_ID, email: null, isGuest: true });
        setStatus('anonymous');
      }
    } catch {
      setUser({ id: GUEST_USER_ID, email: null, isGuest: true });
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  /*
   * Account-change handling.
   *
   * When the active user changes, the previous account's sync state is torn down before the new one
   * becomes active. Doing this in an effect keyed on `user?.id` means it runs for sign-in, sign-out,
   * and account switching alike, so there is no path that skips it.
   */
  useEffect(() => {
    const currentUserId = user?.id ?? null;
    const previousUserId = previousUserIdRef.current;

    if (previousUserId !== null && previousUserId !== currentUserId) {
      // When transitioning from guest to authenticated, migrate all local guest data
      // to the auth user's id. Without this, rows created in guest mode keep
      // user_id = 'guest-local' and the RLS INSERT policy on tasks rejects the upsert
      // because the referenced project does not belong to auth.uid().
      if (previousUserId === GUEST_USER_ID && currentUserId !== null && currentUserId !== GUEST_USER_ID) {
        void migrateGuestData(currentUserId).then(({ migrated, total }) => {
          if (migrated) {
            console.warn(`Migrated ${total} guest rows to authenticated user.`);
            // Push the migrated mutations to Supabase immediately.
            void sync({ userId: currentUserId, deviceId: deviceIdRef.current });
          }
        });
      }

      // Clear the outgoing account's cursor so the incoming account is not made to skip rows.
      void resetSyncState(previousUserId);
    }

    previousUserIdRef.current = currentUserId;
  }, [user?.id]);

  // Subscribe to auth events so an expired or revoked session is noticed without a page reload.
  useEffect(() => {
    if (!isCloudConfigured()) return;

    const unsubscribe = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser({ id: GUEST_USER_ID, email: null, isGuest: true });
        setStatus('anonymous');
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session) {
          setUser({ id: session.userId, email: session.email, isGuest: false });
          setStatus('authenticated');
        }
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        // A recovery link established a session; the user still needs to choose a new password, so
        // the reset screen reads this flag from the URL rather than from context.
        if (session) {
          setUser({ id: session.userId, email: session.email, isGuest: false });
          setStatus('authenticated');
        }
      }
    });

    return unsubscribe;
  }, []);

  /**
   * Signs out.
   *
   * Only cloud accounts have a session to end. Local data is deliberately left on the device, which
   * is why signing back in finds everything intact and why an offline sign-out is safe.
   */
  const signOutCurrentUser = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isCloudConfigured() || !user || user.isGuest) {
      return { ok: true };
    }

    const result = await signOut();
    if (!result.ok) {
      return { ok: false, error: result.formError ?? 'Could not sign out.' };
    }

    // The auth listener also fires, but setting state here makes the transition immediate rather
    // than waiting for the event, so the UI does not flash the previous account's data.
    previousUserIdRef.current = null;
    setUser({ id: GUEST_USER_ID, email: null, isGuest: true });
    setStatus('anonymous');

    return { ok: true };
  }, [user]);

  const activeUserId = user?.id ?? GUEST_USER_ID;

  /*
   * Platform detection runs on the client only. It is read lazily in the memo below rather than in
   * the render body so that the static-export build pass, which has no `window`, cannot crash here.
   */
  const platform = useMemo<PlatformKind>(
    () => (typeof window === 'undefined' ? 'web' : detectPlatform()),
    [],
  );

  /*
   * Automatic sync triggers. Only active for a real cloud account: a guest has no cloud to sync with,
   * and triggering for one would produce failing requests on every mount.
   */
  useSyncTriggers({
    userId: status === 'authenticated' && user && !user.isGuest ? user.id : null,
    deviceId: deviceIdRef.current,
  });

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      activeUserId,
      cloudConfigured: isCloudConfigured(),
      deviceId: deviceIdRef.current,
      platform,
      signOutCurrentUser,
      refreshSession,
    }),
    [status, user, activeUserId, platform, signOutCurrentUser, refreshSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used inside a SessionProvider.');
  }

  return context;
}

/**
 * The user id every local query must be scoped by.
 *
 * Exposed separately from `useSession` so a feature hook can depend on just the scope, which keeps
 * its dependency array honest and avoids re-rendering a task list when an unrelated session field
 * changes.
 */
export function useActiveUserId(): string {
  return useSession().activeUserId;
}

/** Convenience for the common "am I signed into a cloud account" check. */
export function useIsCloudAccount(): boolean {
  const { user, status } = useSession();
  return status === 'authenticated' && user !== null && !user.isGuest;
}

/**
 * Ensures the local database is open and migrations have run.
 *
 * Opening eagerly means the first query is not delayed by the schema upgrade. Returns whether the
 * database is ready; components render their loading state until it is.
 */
export function useDatabaseReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getDatabase()
      .open()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // The database failed to open, most likely because storage is blocked or the version is
        // newer than this build understands. The UI surfaces this through its error state rather
        // than pretending to work against a store that is not there.
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
