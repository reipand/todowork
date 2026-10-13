'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/features/auth/session-context';
import { signInWithEmail } from '@/features/auth/service';

/**
 * Sign in.
 *
 * The form is disabled when cloud is not configured, because `signInWithEmail` needs a Supabase
 * client. A guest-mode notice replaces the form's call to action so the user understands why the
 * button is inert rather than guessing.
 *
 * On success the session context picks up the change via `onAuthStateChange` and the dashboard layout
 * renders. The explicit `router.replace` is a fallback for the case where the listener has not fired
 * yet by the time the promise resolves.
 */
export default function SignInPage() {
  const router = useRouter();
  const { cloudConfigured } = useSession();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFieldErrors({});
    setFormError(null);

    const result = await signInWithEmail({ email: email.trim(), password });

    if (result.ok) {
      toast('Signed in.', { tone: 'success' });
      router.replace('/dashboard');
      return;
    }

    setFieldErrors(result.fieldErrors ?? {});
    setFormError(result.formError ?? 'Could not sign in. Check your email and password.');
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-headline text-ink">Sign in</h1>
        <p className="text-body text-ink-secondary">
          Sign in to sync your tasks across devices. New here?{' '}
          <Link href="/sign-up" className="font-medium text-accent hover:underline">
            Create an account
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
          placeholder="Your password"
          autoComplete="current-password"
          required
          disabled={!cloudConfigured}
        />

        {formError ? (
          <p role="alert" className="text-meta font-medium text-danger">
            {formError}
          </p>
        ) : null}

        <Button type="submit" variant="primary" loading={busy} disabled={!cloudConfigured || busy}>
          Sign in
        </Button>

        <Link
          href="/forgot-password"
          className="self-center text-meta text-ink-muted transition-colors duration-hover hover:text-ink"
        >
          Forgot your password?
        </Link>
      </form>
    </div>
  );
}
