// Supabase Edge Function: delete-account
//
// Permanently deletes the calling user and every row that belongs to them.
//
// Why this must be a server function: deleting a user requires the Supabase Admin API, which
// requires the service_role key. That key bypasses Row Level Security entirely, so it can never
// ship to a browser or a mobile bundle. This function is the only place in the product that holds
// it, and it is supplied by the Edge Function runtime environment rather than being committed.
//
// Identity rule: the user to delete is derived ONLY from the verified JWT. The request body is
// ignored for this purpose, so one user cannot ask to delete another by naming them. That is the
// whole security argument for this function, and it is why there is no `userId` parameter in the
// accepted input.
//
// Data cleanup: every table referencing auth.users(id) declares `on delete cascade`, so removing
// the user removes their profiles, projects, tasks, tags, task_tags, task_subtasks, sync_mutations,
// sync_conflicts and sync_devices rows in the same transaction. There is nothing to delete by hand
// here, and doing so would be worse: a manual, partial delete could leave orphans behind.
//
// Secrets required (set with `supabase secrets set`, never in .env.local):
//   SUPABASE_URL                 -> provided automatically by the Edge Function runtime
//   SUPABASE_SERVICE_ROLE_KEY    -> must be set explicitly; bypasses RLS
//   SUPABASE_ANON_KEY            -> provided automatically; used only for token verification
//   DELETE_ACCOUNT_ALLOWED_ORIGINS -> optional comma-separated CORS allowlist override

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

/**
 * Origins permitted to call this function.
 *
 * The web app, the Vercel preview, and the Capacitor shells all call cross-origin: a packaged
 * Android/iOS app runs on `https://localhost` or `capacitor://localhost` rather than on the
 * deployed domain, so those schemes have to be allowed explicitly or every mobile deletion fails
 * with an opaque CORS error that looks like a server fault.
 *
 * Production origins are configured through DELETE_ACCOUNT_ALLOWED_ORIGINS rather than hardcoded,
 * so a Vercel preview with its own hostname does not require a code change. The defaults below
 * cover local development and the native shells.
 *
 * An origin not on this list is never echoed back. Reflecting arbitrary origins would let any site
 * a signed-in user visits trigger deletion with their ambient credentials.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://localhost',
  'capacitor://localhost',
];

/**
 * Normalises an origin for comparison.
 *
 * A browser always sends `Origin` as scheme + host + optional port, with **no trailing slash and
 * no path**. A secret that was typed or copy-pasted as `https://example.com/` would therefore never
 * match, producing a CORS failure with no useful clue as to why. Trailing slashes are stripped from
 * both sides so the comparison cannot fail on a difference the user cannot see.
 */
function normaliseOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function allowedOrigins(): string[] {
  const configured = Deno.env.get('DELETE_ACCOUNT_ALLOWED_ORIGINS');
  if (!configured) return DEFAULT_ALLOWED_ORIGINS.map(normaliseOrigin);

  return configured
    .split(',')
    .map(normaliseOrigin)
    .filter((origin) => origin.length > 0);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  // The configured origin is echoed back in its original form, not the normalised one, because the
  // browser compares the header against the exact value it sent.
  if (origin && allowedOrigins().includes(normaliseOrigin(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get('origin');

  // Preflight. Answered before any auth check because a browser does not attach the Authorization
  // header to an OPTIONS request, so requiring one here would reject every legitimate preflight.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    // Named individually so a half-configured deployment is obvious from the log, but the values
    // themselves are never printed: these are the keys that bypass RLS.
    console.error(
      'delete-account misconfigured. Missing: ' +
        [
          !supabaseUrl && 'SUPABASE_URL',
          !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
          !anonKey && 'SUPABASE_ANON_KEY',
        ]
          .filter(Boolean)
          .join(', '),
    );
    return json({ error: 'Account deletion is not configured on the server.' }, 500, origin);
  }

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '').trim();

  if (!authHeader || !accessToken) {
    return json({ error: 'You must be signed in to delete your account.' }, 401, origin);
  }

  // Verify the token against the Auth server. A locally-decoded JWT would be cheaper but would
  // trust a token that may already be revoked, and deleting an account is not an action to take on
  // the strength of an unverified claim.
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);

  if (userError || !userData.user) {
    // The token is expired, revoked, or forged. The message stays vague because distinguishing
    // those cases tells an attacker which part of a forged token to fix.
    return json({ error: 'Your session is no longer valid. Sign in again and retry.' }, 401, origin);
  }

  const userId = userData.user.id;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

  if (deleteError) {
    // Logged with the user id so the failure is traceable, but without the token or the key.
    console.error(`delete-account failed for user ${userId}: ${deleteError.message}`);
    return json({ error: 'Could not delete the account. Nothing was removed; try again.' }, 500, origin);
  }

  console.log(`delete-account succeeded for user ${userId}`);

  return json({ ok: true }, 200, origin);
});
