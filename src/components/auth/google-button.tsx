'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { signInWithGoogle } from '@/features/auth/service';

/**
 * "Continue with Google" button.
 *
 * Shared by sign-in and sign-up because the two do the same thing: Supabase creates the account on
 * first consent and signs the user in on every subsequent one, so there is no separate flow to
 * maintain. Presenting it on both screens also means a user who arrives at the wrong page does not
 * have to navigate away to get the button they were looking for.
 *
 * The button owns its own busy/error state rather than lifting it to the page, so the two auth
 * pages do not each carry OAuth bookkeeping that only this control needs.
 */
export function GoogleButton({
  disabled = false,
  label = 'Continue with Google',
  redirectPath = '/dashboard',
}: {
  /** Set when the build has no cloud configuration; the button is then inert, like the forms. */
  disabled?: boolean;
  label?: string;
  /** Internal path to land on after the round trip. Validated again inside the service. */
  redirectPath?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    const result = await signInWithGoogle(redirectPath);

    if (!result.ok) {
      setError(result.formError ?? 'Could not start Google sign-in. Please try again.');
      setBusy(false);
      return;
    }

    // On success the browser navigates to Google. `busy` is deliberately left asserted so the
    // button cannot be clicked twice during the brief window before the page unloads.
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={() => void handleClick()}
        loading={busy}
        disabled={disabled || busy}
        className="w-full"
      >
        {busy ? null : <GoogleGlyph />}
        {label}
      </Button>

      {error ? (
        <p role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Google's "G" mark.
 *
 * Inlined as an SVG rather than shipped as a file so it needs no network request and no build
 * asset step, and so its colours are fixed by the brand guidelines instead of inheriting the
 * theme's `currentColor` (which would render a monochrome mark on the dark theme).
 *
 * `aria-hidden` because the button's text already names the provider; announcing the logo again
 * would repeat "Google" to a screen reader.
 */
function GoogleGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-4 w-4 shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
