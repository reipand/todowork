'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, LogIn, LogOut, Trash2 } from 'lucide-react';

import { PageContent, PageHeader, SectionHeading } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useIsCloudAccount, useSession } from '@/features/auth/session-context';
import { requestAccountDeletion } from '@/features/auth/service';
import { destroyLocalDatabase, getDatabase } from '@/lib/db/schema';
import { useTheme, type ThemePreference } from '@/features/settings/theme-context';
import { cn } from '@/lib/utils';

/**
 * Settings.
 *
 * A hub rather than tabs, because the four sections are short and a tab bar would add a layer of
 * navigation for very little content. Each section is a real page section with its own heading,
 * which keeps the heading order honest: one `h1` from the page header, then `h2`s per section.
 *
 * The destructive actions — sign out, delete account, remove local data — each go through a
 * confirmation dialog. Nothing destructive happens on a single click.
 */

export default function SettingsPage() {
  const router = useRouter();
  const { user, status, signOutCurrentUser, cloudConfigured, deviceId, platform } = useSession();
  const isCloudAccount = useIsCloudAccount();
  const { preference, setPreference } = useTheme();
  const { toast } = useToast();

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [removeDataOpen, setRemoveDataOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Counts for the Data section. Read from Dexie so they are accurate offline and update the
  // instant a change lands. `undefined` while the first read is in flight.
  const counts = useLiveQuery(
    async () => {
      const db = getDatabase();
      const [tasks, projects, tags, mutations] = await Promise.all([
        db.tasks.count(),
        db.projects.count(),
        db.tags.count(),
        db.mutations.count(),
      ]);
      return { tasks, projects, tags, mutations };
    },
    [],
    undefined,
  );

  const handleSignOut = async (): Promise<void> => {
    setBusy(true);
    const result = await signOutCurrentUser();
    setBusy(false);
    setSignOutOpen(false);

    if (result.ok) {
      toast('Signed out. Your tasks are still on this device.', { tone: 'success' });
      router.push('/sign-in');
    } else {
      toast(result.error ?? 'Could not sign out.', { tone: 'danger' });
    }
  };

  const handleDeleteAccount = async (): Promise<void> => {
    setBusy(true);
    const result = await requestAccountDeletion();
    setBusy(false);
    setDeleteAccountOpen(false);

    if (result.ok) {
      toast(
        'Account deletion started. You will receive a confirmation email. Signing out of this device now.',
        { tone: 'success' },
      );
      await signOutCurrentUser();
      router.push('/sign-in');
    } else {
      toast(result.formError ?? 'Could not start account deletion.', { tone: 'danger' });
    }
  };

  const handleRemoveLocalData = async (): Promise<void> => {
    setBusy(true);
    try {
      await destroyLocalDatabase();
      // A reload is required: every hook holds a reference to the closed database, and the only
      // honest way to re-open it is to re-mount the whole application.
      window.location.reload();
    } catch {
      setBusy(false);
      setRemoveDataOpen(false);
      toast('Could not remove local data. Reload the page and try again.', { tone: 'danger' });
    }
  };

  const accountEmail = user?.email ?? null;
  const isGuest = !isCloudAccount;

  return (
    <>
      <PageHeader title="Settings" description="Account, appearance, sync and your local data." />

      <PageContent>
        <div className="flex flex-col gap-8">
          {/* Account --------------------------------------------------------------- */}
          <section aria-label="Account">
            <SectionHeading as="h2">Account</SectionHeading>

            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-meta text-ink-muted">Status</span>
                <span className="text-body text-ink">
                  {status === 'loading'
                    ? 'Checking…'
                    : isGuest
                      ? 'Working locally (guest)'
                      : 'Signed in'}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-3">
                <span className="text-meta text-ink-muted">Email</span>
                <span className="text-body text-ink">{accountEmail ?? '—'}</span>
              </div>

              <div className="flex items-baseline justify-between gap-3">
                <span className="text-meta text-ink-muted">Device</span>
                <span className="text-body text-ink">
                  <span className="capitalize">{platform}</span>
                  <span className="tabular text-ink-muted"> · {deviceId.slice(0, 8)}</span>
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {isGuest ? (
                  <Link
                    href="/sign-in"
                    className="inline-flex h-9 items-center gap-2 rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
                  >
                    <LogIn aria-hidden="true" className="h-4 w-4" />
                    Sign in to sync
                  </Link>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => setSignOutOpen(true)} disabled={busy}>
                      <LogOut aria-hidden="true" className="h-4 w-4" />
                      Sign out
                    </Button>

                    {cloudConfigured ? (
                      <Button variant="danger" onClick={() => setDeleteAccountOpen(true)} disabled={busy}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                        Delete account
                      </Button>
                    ) : null}
                  </>
                )}

                {!cloudConfigured ? (
                  <p className="basis-full text-meta text-ink-muted">
                    Cloud sync is not configured on this build, so sign-in and account deletion are unavailable.
                    Set the Supabase environment variables to enable them.
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {/* Appearance ----------------------------------------------------------- */}
          <section aria-label="Appearance">
            <SectionHeading as="h2">Appearance</SectionHeading>

            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <p className="text-body text-ink-secondary">
                The theme follows your system by default. Choose an explicit one to override it.
              </p>

              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">Theme</legend>
                {(['system', 'light', 'dark'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPreference(value as ThemePreference)}
                    aria-pressed={preference === value}
                    className={cn(
                      'h-9 rounded-control border px-3.5 text-body font-medium capitalize transition-colors duration-hover',
                      preference === value
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line-strong bg-surface text-ink-secondary hover:bg-sunken hover:text-ink',
                    )}
                  >
                    {value}
                  </button>
                ))}
              </fieldset>
            </div>
          </section>

          {/* Data ----------------------------------------------------------------- */}
          <section aria-label="Data">
            <SectionHeading as="h2">Local data</SectionHeading>

            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              {counts === undefined ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Count label="Tasks" value={counts.tasks} />
                  <Count label="Projects" value={counts.projects} />
                  <Count label="Tags" value={counts.tags} />
                  <Count label="Queued changes" value={counts.mutations} />
                </dl>
              )}

              <p className="text-meta text-ink-muted">
                Your data lives in this browser&apos;s IndexedDB. Removing it cannot be undone and deletes
                everything on this device, including queued changes that have not synced yet.
              </p>

              <Button variant="danger" onClick={() => setRemoveDataOpen(true)} disabled={busy}>
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                Remove local data
              </Button>
            </div>
          </section>

          {/* Sync ----------------------------------------------------------------- */}
          <section aria-label="Sync">
            <SectionHeading as="h2">Sync</SectionHeading>

            <Link
              href="/settings/sync"
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 transition-colors duration-hover hover:bg-sunken/60"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-medium text-ink">Sync status and conflicts</span>
                <span className="text-meta text-ink-muted">
                  See pending changes, retry failures, and resolve conflicts.
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
            </Link>
          </section>
        </div>
      </PageContent>

      <ConfirmDialog
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        onConfirm={() => void handleSignOut()}
        title="Sign out of this device?"
        description="Your tasks stay on this device and will be here when you sign back in. Only this device's session ends."
        confirmLabel="Sign out"
        busy={busy}
      />

      <ConfirmDialog
        open={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
        onConfirm={() => void handleDeleteAccount()}
        title="Delete your account?"
        description="This starts permanent deletion of your account and all synced data. The Edge Function must be deployed for this to complete. This cannot be undone."
        confirmLabel="Delete account"
        tone="danger"
        busy={busy}
      />

      <ConfirmDialog
        open={removeDataOpen}
        onClose={() => setRemoveDataOpen(false)}
        onConfirm={() => void handleRemoveLocalData()}
        title="Remove all local data?"
        description="Everything on this device is deleted: tasks, projects, tags, and any queued changes that have not synced yet. This cannot be undone."
        confirmLabel="Remove local data"
        tone="danger"
        busy={busy}
      />
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta text-ink-muted">{label}</dt>
      <dd className="tabular text-title text-ink">{value}</dd>
    </div>
  );
}
