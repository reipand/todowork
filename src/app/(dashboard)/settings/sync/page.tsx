'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';

import { PageContent, PageHeader, SectionHeading } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/states';
import { useSyncStatus } from '@/components/ui/sync-indicator';
import { useToast } from '@/components/ui/toast';
import { useActiveUserId, useIsCloudAccount } from '@/features/auth/session-context';
import { decodeRowFromStorage, getDatabase } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import type { SyncConflict } from '@/types/domain';

/**
 * Sync settings.
 *
 * Surfaces the sync engine's live state — phase, counts, last sync time — and the two actions a user
 * can take: sync now and retry failed. Conflicts are listed read-only.
 *
 * Conflict resolution is not implemented in this build. The engine records conflicts and marks the
 * affected entities, but the resolution UI (choose local, choose remote, merge) does not exist yet.
 * Showing the conflicts with an honest note is better than hiding them: a user who sees a conflict
 * can at least decide whether to re-apply their change manually.
 */

export default function SyncSettingsPage() {
  const userId = useActiveUserId();
  const isCloudAccount = useIsCloudAccount();
  const { phase, pendingCount, failedCount, conflictCount, lastSyncedAt, triggerSync, retryFailed, isSyncing } =
    useSyncStatus();
  const { toast } = useToast();

  const [syncing, setSyncing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const conflicts = useLiveQuery(
    async () => {
      const db = getDatabase();
      const rows = await db.conflicts.where('user_id').equals(userId).toArray();
      return rows
        .filter((row) => row.resolved_at === null)
        .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
    },
    [userId],
    undefined,
  );

  const handleSync = async (): Promise<void> => {
    setSyncing(true);
    try {
      await triggerSync();
      toast('Sync complete.', { tone: 'success' });
    } catch {
      toast('Sync failed. Check your connection and try again.', { tone: 'danger' });
    } finally {
      setSyncing(false);
    }
  };

  const handleRetry = async (): Promise<void> => {
    setRetrying(true);
    try {
      await retryFailed();
      toast('Failed changes re-queued. Syncing now.', { tone: 'success' });
    } catch {
      toast('Could not re-queue failed changes.', { tone: 'danger' });
    } finally {
      setRetrying(false);
    }
  };

  if (!isCloudAccount) {
    return (
      <>
        <PageHeader
          title="Sync"
          description="Your tasks are stored on this device. Sync connects them to your cloud account."
          action={
            <Link
              href="/settings"
              className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Settings
            </Link>
          }
        />
        <PageContent>
          <EmptyState
            title="Sync is not active"
            description="You are working as a guest. Your tasks live only on this device. Sign in to sync them across devices."
            action={
              <Link
                href="/sign-in"
                className="inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-body font-medium text-accent-fg transition-colors duration-hover hover:bg-accent-hover"
              >
                Sign in to sync
              </Link>
            }
          />
        </PageContent>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sync"
        description="Synchronise your tasks across devices and review conflicts."
        action={
          <Link
            href="/settings"
            className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Settings
          </Link>
        }
      />

      <PageContent>
        <div className="flex flex-col gap-8">
          {/* Status ----------------------------------------------------------------- */}
          <section aria-label="Sync status">
            <SectionHeading as="h2">Status</SectionHeading>

            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-meta text-ink-muted">Phase</span>
                <span className="text-body font-medium text-ink">
                  <PhaseLabel phase={phase} syncing={syncing || isSyncing} />
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-3">
                <span className="text-meta text-ink-muted">Last synced</span>
                <span className="text-body text-ink">{formatTimestamp(lastSyncedAt)}</span>
              </div>

              <dl className="grid grid-cols-3 gap-3">
                <Stat label="Pending" value={pendingCount} />
                <Stat label="Failed" value={failedCount} tone={failedCount > 0 ? 'danger' : undefined} />
                <Stat label="Conflicts" value={conflictCount} tone={conflictCount > 0 ? 'warning' : undefined} />
              </dl>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => void handleSync()}
                  loading={syncing || isSyncing}
                  disabled={syncing || isSyncing}
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  Sync now
                </Button>

                {failedCount > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => void handleRetry()}
                    loading={retrying}
                    disabled={retrying}
                  >
                    <RotateCcw aria-hidden="true" className="h-4 w-4" />
                    Retry {failedCount} failed
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          {/* Conflicts ------------------------------------------------------------- */}
          <section aria-label="Conflicts">
            <SectionHeading as="h2">Conflicts</SectionHeading>

            {conflicts === undefined ? (
              <div className="rounded-card border border-line bg-surface p-4">
                <Skeleton className="h-20 w-full rounded-control" />
              </div>
            ) : conflicts.length === 0 ? (
              <div className="rounded-card border border-line bg-surface p-4">
                <p className="text-body text-ink-secondary">No unresolved conflicts.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2 rounded-control border border-warning/40 bg-warning-soft p-3">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p className="text-meta text-ink-secondary">
                    These conflicts need a decision, but conflict resolution is not implemented in this
                    build. You can review both versions below and re-apply your change manually from the
                    relevant task or project.
                  </p>
                </div>

                <ul className="flex flex-col gap-3">
                  {conflicts.map((conflict) => (
                    <ConflictCard key={conflict.id} conflict={conflict} />
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </PageContent>
    </>
  );
}

function PhaseLabel({ phase, syncing }: { phase: string; syncing: boolean }) {
  if (syncing) return 'Syncing…';

  const labels: Record<string, string> = {
    idle: 'Up to date',
    offline: 'Offline',
    syncing: 'Syncing…',
    pending: `${'pending'} changes waiting`,
    error: 'Sync error',
    conflict: 'Conflicts need attention',
  };

  return labels[phase] ?? phase;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'warning' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'tabular text-title',
          tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ConflictCard({ conflict }: { conflict: SyncConflict }) {
  const fields = conflict.conflicting_fields.split(',').filter(Boolean);
  const local = safeParse(conflict.local_payload);
  const remote = safeParse(conflict.remote_payload);

  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-medium text-ink">
          <span className="capitalize">{conflict.entity_type}</span>{' '}
          <span className="tabular text-ink-muted">{conflict.entity_id.slice(0, 8)}</span>
        </span>
        <span className="text-meta text-ink-muted">{formatTimestamp(conflict.detected_at)}</span>
      </div>

      {fields.length > 0 ? (
        <div className="flex flex-col gap-2">
          {fields.map((field) => (
            <div key={field} className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-meta text-ink-muted">Your version</span>
                <span className="text-body text-ink">{displayValue(local?.[field])}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-meta text-ink-muted">Other version</span>
                <span className="text-body text-ink-secondary">{displayValue(remote?.[field])}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-meta text-ink-muted">The conflicting fields could not be read.</p>
      )}
    </li>
  );
}

function safeParse(payload: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return decodeRowFromStorage(parsed);
  } catch {
    return null;
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '—';
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}
