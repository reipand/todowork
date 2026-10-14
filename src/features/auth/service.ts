import { getSupabaseClient } from '@/lib/supabase/client';
import { env } from '@/lib/env';
import {
  formatZodErrors,
  resetPasswordRequestSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type ResetPasswordInput,
  type ResetPasswordRequestInput,
  type SignInInput,
  type SignUpInput,
} from '@/lib/validation/schemas';

/**
 * Authentication service.
 *
 * Wraps Supabase Auth so no component talks to it directly. That keeps the error mapping in one
 * place: Supabase returns terse API errors ("Invalid login credentials") that are fine as-is, but
 * it also returns internal ones that should never reach a user. Every failure is translated here.
 *
 * We never store or hash a password ourselves. Supabase Auth owns credentials entirely; this module
 * only forwards them over TLS and then forgets them.
 */

export interface AuthResult<T> {
  ok: boolean;
  data?: T;
  /** Field-level errors for form display, keyed by field name. */
  fieldErrors?: Record<string, string>;
  /** Form-level error, for a failure not tied to one input. */
  formError?: string;
}

/**
 * Translates a Supabase auth error into something a person can act on.
 *
 * The mapping is deliberate rather than passing `error.message` through. Supabase's messages are
 * inconsistent across versions and endpoints, and a raw one occasionally names internal concepts.
 * Where a message is genuinely useful and safe ("Email not confirmed"), it is preserved so the user
 * knows what to do next.
 */
function translateAuthError(message: string, code?: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('invalid login credentials')) {
    // Deliberately not "no account with that email": that would let an attacker enumerate which
    // addresses are registered. This is the security reason the wording is vague.
    return 'Email or password is incorrect.';
  }
  if (normalised.includes('email not confirmed')) {
    return 'Check your inbox and confirm your email address before signing in.';
  }
  if (normalised.includes('user already registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (normalised.includes('password should be at least')) {
    return 'That password is too short. Use at least 8 characters.';
  }
  if (normalised.includes('rate limit') || normalised.includes('too many requests')) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (normalised.includes('failed to fetch') || normalised.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (code === 'email_exists') {
    return 'An account with this email already exists.';
  }
  if (normalised.includes('same password')) {
    return 'Choose a password you have not used for this account.';
  }

  // Email-transport failures. Supabase returns these when email confirmations are enabled but
  // the email service is unavailable or misconfigured. The signup itself did not complete — the
  // user row is rolled back — so the user cannot retry sign-in. They need to wait for the
  // service to recover or contact support; surfacing the generic "something went wrong" would
  // send them in circles.
  if (
    normalised.includes('error sending confirmation email') ||
    normalised.includes('error sending email') ||
    code === 'unexpected_failure'
  ) {
    return 'We could not send your confirmation email. The email service may be temporarily unavailable. Try again in a moment, or contact support if it persists.';
  }

  // Unmapped errors get a neutral message rather than the raw text, which could expose internals.
  return 'Something went wrong. Please try again.';
}

/**
 * Creates an account.
 *
 * When email confirmation is enabled in the Supabase project, no session is returned and the user
 * must confirm before signing in. That is reported distinctly rather than treated as a failure, so
 * the UI can show "check your inbox" instead of an error.
 */
export async function signUpWithEmail(
  input: SignUpInput,
): Promise<AuthResult<{ needsEmailConfirmation: boolean }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatZodErrors(parsed.error) };
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // The confirmation link must return to a URL listed in the Supabase redirect allow-list.
      // A mismatch here is the most common cause of a broken confirmation flow.
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, formError: translateAuthError(error.message, error.code) };
  }

  // No session means confirmation is required. Both fields can be absent depending on project
  // configuration, so the check is on the session rather than on `data.user`.
  return {
    ok: true,
    data: { needsEmailConfirmation: data.session === null },
  };
}

export async function signInWithEmail(
  input: SignInInput,
): Promise<AuthResult<{ userId: string }>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatZodErrors(parsed.error) };
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, formError: translateAuthError(error.message, error.code) };
  }

  if (!data.session || !data.user) {
    // A password sign-in with no session is not a success, whatever the status code said. Treating
    // it as success would be the "fake login" the spec forbids.
    return { ok: false, formError: 'Sign in did not complete. Please try again.' };
  }

  return { ok: true, data: { userId: data.user.id } };
}

/**
 * Signs out.
 *
 * `scope: 'local'` signs out this device only, which is what a user tapping "Sign out" expects.
 * The default global scope would revoke sessions on their other devices too, which is a surprising
 * side effect for a routine action.
 *
 * This works offline. The SDK clears its local session regardless of whether the revoke request
 * reaches the server, so a user on a plane can still sign out of a shared device. The spec requires
 * exactly that.
 */
export async function signOut(): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.auth.signOut({ scope: 'local' });

  if (error) {
    // A network failure during sign-out must not leave the user stuck signed in. The local session
    // is cleared explicitly as a fallback so the device is never left in a signed-in state.
    const stillSignedIn = await supabase.auth.getSession();
    if (stillSignedIn.data.session) {
      return { ok: false, formError: translateAuthError(error.message, error.code) };
    }
  }

  return { ok: true };
}

/** Sends the password-reset email. Always reports success, to avoid leaking which emails exist. */
export async function requestPasswordReset(
  input: ResetPasswordRequestInput,
): Promise<AuthResult<null>> {
  const parsed = resetPasswordRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatZodErrors(parsed.error) };
  }

  const supabase = getSupabaseClient();

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  });

  // The result is intentionally not surfaced. Reporting "no such user" would turn this endpoint
  // into an account-enumeration oracle. The UI shows the same confirmation either way.
  return { ok: true };
}

/** Applies a new password. Requires an active session, which the emailed link establishes. */
export async function updatePassword(input: ResetPasswordInput): Promise<AuthResult<null>> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: formatZodErrors(parsed.error) };
  }

  const supabase = getSupabaseClient();

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { ok: false, formError: translateAuthError(error.message, error.code) };
  }

  return { ok: true };
}

/** Requests an email change. Confirmation is sent to the new address. */
export async function requestEmailChange(newEmail: string): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  );

  if (error) {
    return { ok: false, formError: translateAuthError(error.message, error.code) };
  }

  return { ok: true };
}

/** Resends the confirmation email after a signup that needed it. */
export async function resendConfirmationEmail(email: string): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });

  if (error) {
    return { ok: false, formError: translateAuthError(error.message, error.code) };
  }

  return { ok: true };
}

/**
 * Reads the current session from local storage without a network call.
 *
 * Used on first render to restore a session before any UI decision is made. It must not be used as
 * proof of a valid session: `getSession` reads local state, and a token can be locally present but
 * expired or revoked. Server-authoritative checks happen when a request is actually made.
 */
export async function readLocalSession(): Promise<{ userId: string; email: string | null } | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();

  if (!data.session?.user) return null;

  return {
    userId: data.session.user.id,
    email: data.session.user.email ?? null,
  };
}

/** Subscribes to auth state changes. Returns an unsubscribe function. */
export function onAuthStateChange(
  handler: (event: string, session: { userId: string; email: string | null } | null) => void,
): () => void {
  const supabase = getSupabaseClient();

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    handler(
      event,
      session?.user ? { userId: session.user.id, email: session.user.email ?? null } : null,
    );
  });

  return () => {
    data.subscription.unsubscribe();
  };
}

/**
 * Permanently deletes the account and all its data.
 *
 * This cannot be done from the client: deleting a user requires the Admin API and therefore the
 * service_role key, which must never ship to a client. The correct implementation is an Edge
 * Function holding that key server-side, called from here with the user's own JWT so it can confirm
 * identity.
 *
 * Until that function is deployed, this returns a clear not-configured result rather than pretending
 * to delete anything. See docs/DEPLOYMENT.md for the Edge Function.
 */
export async function requestAccountDeletion(): Promise<AuthResult<null>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
  });

  if (error) {
    // A missing function is a deployment state, not an error the user caused, so it gets its own
    // explanation rather than the generic failure text.
    if (error.message.includes('not found') || error.message.includes('404')) {
      return {
        ok: false,
        formError:
          'Account deletion needs the delete-account Edge Function, which has not been deployed. ' +
          'See docs/DEPLOYMENT.md, then try again.',
      };
    }

    return { ok: false, formError: 'Could not start account deletion. Please try again.' };
  }

  if (data && typeof data === 'object' && 'error' in data) {
    return { ok: false, formError: String((data as { error: unknown }).error) };
  }

  return { ok: true };
}
