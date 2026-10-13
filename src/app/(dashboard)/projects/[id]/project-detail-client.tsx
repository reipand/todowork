'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { PageContent } from '@/components/layout/page-header';
import { TaskListView } from '@/components/tasks/task-list-view';
import { EmptyState, Skeleton, StatsSkeleton } from '@/components/ui/states';
import { decodeRowFromStorage, getDatabase } from '@/lib/db/schema';
import { useActiveUserId } from '@/features/auth/session-context';

/**
 * Reads the project id from the browser URL.
 *
 * In a static export with a rewrite fallback, `useParams()` can return the build-time sentinel
 * `_` even after mount, because the router sees the statically-generated path. Reading
 * `window.location.pathname` is the reliable source of truth for the real id.
 */
function readProjectIdFromPath(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/projects\/([^/]+)/);
  const captured = match?.[1];
  if (!captured || captured === '_') return null;
  return captured;
}

/**
 * Project detail (client).
 *
 * Reads the id from the URL rather than from server params, because the route is exported with a
 * single sentinel id (see the page wrapper) and the real id only exists at runtime. A mounted gate
 * prevents the sentinel id from driving a render before hydration, which would flash "not found".
 */

export function ProjectDetailClient() {
  const params = useParams<{ id: string }>();
  const paramId = typeof params?.id === 'string' ? params.id : null;
  const userId = useActiveUserId();

  // The gate. Until the component has mounted, params may still be the build-time sentinel, and
  // any read against it would either miss or briefly render the wrong project.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Prefer the router param, but fall back to the URL pathname when the param is still the
  // sentinel `_` — which happens on static-export rewrite fallbacks.
  const id = mounted
    ? paramId && paramId !== '_'
      ? paramId
      : readProjectIdFromPath()
    : null;

  const project = useLiveQuery(
    async () => {
      if (!id) return null;
      const db = getDatabase();
      const row = await db.projects.get(id);
      if (!row) return null;
      const decoded = decodeRowFromStorage(row);
      // Ownership and liveness checks, mirroring the services: a row from another account or a
      // tombstoned project must not render as if it were this user's.
      if (decoded.user_id !== userId || decoded.deleted_at !== null) return null;
      return decoded;
    },
    [id, userId],
    undefined,
  );

  const isLoading = id === null || project === undefined;
  const notFound = id !== null && project === null;

  if (isLoading) {
    return (
      <>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-5 sm:px-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <PageContent>
          <StatsSkeleton cards={3} />
        </PageContent>
      </>
    );
  }

  if (notFound) {
    return (
      <PageContent>
        <EmptyState
          title="Project not found"
          description="This project may have been deleted, or the link is out of date. Your tasks are unaffected."
          action={
            <Link
              href="/projects"
              className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
            >
              Back to projects
            </Link>
          }
        />
      </PageContent>
    );
  }

  const current = project;
  if (!current) return null; // Satisfies the type-checker; the branches above cover the runtime cases.

  const taskCountHint = current.archived_at !== null ? 'Archived · tasks are read-only below' : undefined;

  return (
    <TaskListView
      title={current.name}
      description={current.description ?? taskCountHint ?? 'Tasks in this project.'}
      baseFilters={{ projectIds: [current.id] }}
      quickAdd={current.archived_at === null ? { defaultProjectId: current.id } : undefined}
      groupBy="due"
      selectable={current.archived_at === null}
      headerAction={
        <Link
          href="/projects"
          className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          All projects
        </Link>
      }
      emptyState={{
        title: 'No tasks in this project yet',
        description:
          current.archived_at === null
            ? 'Add a task above. It will be saved to this project and appear here immediately.'
            : 'This project is archived. Unarchive it on the projects list to add tasks again.',
        action: (
          <Link
            href="/tasks"
            className="inline-flex h-9 items-center rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken"
          >
            See all tasks
          </Link>
        ),
      }}
    />
  );
}
