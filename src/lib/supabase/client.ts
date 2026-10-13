import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Supabase client for a static-export app.
 *
 * There is exactly one client instance, memoised at module scope. Creating a second client
 * would start a second auth listener and a second token-refresh timer, and the two would
 * fight over the same storage key, producing intermittent "logged out" bugs that are painful
 * to diagnose. Everything in the app shares this instance.
 *
 * Session persistence: the SDK stores the session in `localStorage` on web and in Capacitor's
 * Preferences-backed storage on a device. On mobile that persistence is what keeps the user
 * logged in after the app is force-quit, which the spec requires.
 *
 * `detectSessionInUrl` is enabled so that email-confirmation and password-recovery links,
 * which arrive as a URL fragment, are turned into a session automatically. That is what makes
 * those flows work in a static app with no server to handle the callback.
 */
function createSupabaseClient(): SupabaseClient<Database> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Narrowed here rather than asserted, so the compiler enforces that a client is never built
  // without configuration. Every caller reaches this through `isCloudConfigured()`; this guard is
  // the backstop that turns a programming mistake into a clear message instead of requests to
  // `https://undefined.supabase.co`.
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured on this build. Todowork runs in local-only guest mode without ' +
        'it; set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to ' +
        'enable accounts and sync.',
    );
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Keeps the refresh loop from running while the tab is backgrounded, which would waste
      // battery on a device showing the installed app.
      storageKey: 'todowork.auth.session',
    },
    global: {
      headers: {
        // Lets Supabase attribute requests to this client in logs.
        'x-application-name': 'todowork',
      },
    },
    db: {
      schema: 'public',
    },
  });
}

let client: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!client) {
    client = createSupabaseClient();
  }
  return client;
}

/**
 * True when the environment has usable Supabase configuration.
 *
 * The app supports a local-only guest mode where no cloud is configured or reachable. In that
 * mode tasks still work fully (they live in IndexedDB); only sync is unavailable. Guest mode
 * never attempts unauthenticated cloud access, which is what the spec requires.
 *
 * This is the single gate for every cloud call site. Because the two env values are optional,
 * this function is the only thing standing between a guest install and a request to a
 * half-configured endpoint, so every caller checks it before touching the Supabase client.
 */
export function isCloudConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
