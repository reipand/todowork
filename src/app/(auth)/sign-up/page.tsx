'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { GoogleButton } from '@/components/auth/google-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/features/auth/session-context';
import { signUpWithEmail } from '@/features/auth/service';

/**
 * Sign up.
 *
 * After a successful sign-up, two outcomes are possible: the Supabase project requires email
 * confirmation (the session is null, `needsEmailConfirmation` is true) or it does not (a session
 * exists). The confirmation-required path shows a message and sends the user to sign-in; the
 * immediate-session path redirects to the dashboard.
 *
 * The form is disabled when cloud is not configured, with the same guest-mode notice as sign-in.
 */
export default function SignUpPage() {
  const router = useRouter();
  const { cloudConfigured } = useSession();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationNeeded, setConfirmationNeeded] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFieldErrors({});
    setFormError(null);

    const result = await signUpWithEmail({ email: email.trim(), password, confirmPassword });

    if (result.ok) {
      if (result.data?.needsEmailConfirmation) {
        setConfirmationNeeded(true);
        toast('Check your email for a confirmation link.', { tone: 'success' });
      } else {
        toast('Account created.', { tone: 'success' });
        router.replace('/dashboard');
      }
      return;
    }

    setFieldErrors(result.fieldErrors ?? {});
    setFormError(result.formError ?? 'Could not create an account.');
    setBusy(false);
  };

  if (confirmationNeeded) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-headline text-ink">Check your email</h1>
        <p className="text-body text-ink-secondary">
          A confirmation link was sent to{' '}
          <span className="font-medium text-ink">{email.trim()}</span>. Click the link to activate
          your account, then sign in.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex h-9 items-center justify-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-headline text-ink">Create an account</h1>
        <p className="text-body text-ink-secondary">
 Already have one?{' '}
          <Link href="/sign-in" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
          .
        </p>
      </div>

      {!cloudConfigured ? (
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-body text-ink-secondary">
            Cloud sync is not configured on this build. You can still use the app as a guest — your
            tasks are stored on this device.
          </p>
          <Link
            href="/dashboard"
            className="mt-3 inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
          >
            Continue as guest
          </Link>
        </div>
      ) : null}

      <GoogleButton
        disabled={!cloudConfigured}
        label="Sign up with Google"
      />

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-meta text-ink-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-4"
      >
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          placeholder="you@example.com"
          autoComplete="email"
          autoFocus
          required
          disabled={!cloudConfigured}
        />

        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          hint="At least 8 characters."
          autoComplete="new-password"
          required
          disabled={!cloudConfigured}
        />

        <Input
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={fieldErrors.confirmPassword}
          autoComplete="new-password"
          required
          disabled={!cloudConfigured}
        />

        {formError ? (
          <p role="alert" className="text-meta font-medium text-danger">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" loading={busy} disabled={!cloudConfigured || busy}>
          Create account
        </Button>
      </form>
    </div>
  );
}
