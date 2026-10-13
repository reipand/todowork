'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/features/auth/session-context';
import { updatePassword } from '@/features/auth/service';

/**
 * Reset password.
 *
 * Reached via the recovery link, which establishes a session with `PASSWORD_RECOVERY` scope. The
 * Supabase client processes the link at `/auth/callback`, which then redirects here. The session
 * is already established by the time this page renders, so `updatePassword` uses it directly.
 *
 * On success the user is sent to the dashboard. They do not need to sign in again — the recovery
 * session is a real session, and updating the password does not invalidate it.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { cloudConfigured } = useSession();
  const { toast } = useToast();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFieldErrors({});
    setFormError(null);

    const result = await updatePassword({ password, confirmPassword });

    if (result.ok) {
      toast('Password updated.', { tone: 'success' });
      router.replace('/dashboard');
      return;
    }

    setFieldErrors(result.fieldErrors ?? {});
    setFormError(result.formError ?? 'Could not update your password.');
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-headline text-ink">Choose a new password</h1>
        <p className="text-body text-ink-secondary">
          Your recovery link is valid. Set a new password below.
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
          label="New password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          hint="At least 8 characters."
          autoComplete="new-password"
          autoFocus
          required
          disabled={!cloudConfigured}
        />

        <Input
          label="Confirm new password"
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
          Update password
        </Button>
      </form>
    </div>
  );
}
