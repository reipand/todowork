'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { useSession } from '@/features/auth/session-context';
import { requestPasswordReset } from '@/features/auth/service';

/**
 * Forgot password.
 *
 * The reset endpoint never reveals whether an account exists for the given email, because that
 * would be an account-enumeration vector. So this page always shows the same success message after
 * submit, regardless of the outcome. The real feedback is the email the user receives — if one
 * exists for that address.
 *
 * The form is disabled when cloud is not configured.
 */
export default function ForgotPasswordPage() {
  const { cloudConfigured } = useSession();

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);

    // The result is intentionally ignored: `requestPasswordReset` always returns `ok: true` to
    // prevent account enumeration. The success screen is shown unconditionally.
    await requestPasswordReset({ email: email.trim() });

    setBusy(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-headline text-ink">Check your email</h1>
        <p className="text-body text-ink-secondary">
          If an account exists for{' '}
          <span className="font-medium text-ink">{email.trim()}</span>, a password reset link is on
          its way. Click the link to choose a new password.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex h-9 items-center justify-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-headline text-ink">Reset your password</h1>
        <p className="text-body text-ink-secondary">
          Enter the email tied to your account. A reset link will be sent to it.
        </p>
      </div>

      {!cloudConfigured ? (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-body text-ink-secondary">
            Cloud sync is not configured on this build, so password reset is unavailable.
          </p>
          <Link
            href="/dashboard"
            className="mt-3 inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
          >
            Continue as guest
          </Link>
        </div>
      ) : null}

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-4"
      >
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={!cloudConfigured}
        />

        <Button type="submit" variant="primary" loading={busy} disabled={!cloudConfigured || busy}>
          Send reset link
        </Button>

        <Link
          href="/sign-in"
          className="self-center text-meta text-ink-muted transition-colors duration-hover hover:text-ink"
        >
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
