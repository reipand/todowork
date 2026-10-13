'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { FolderPlus, Trash2 } from 'lucide-react';

import { PageContent, PageHeader } from '@/components/layout/page-header';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, StatsSkeleton } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useActiveUserId, useDatabaseReady } from '@/features/auth/session-context';
import { computeProjectProgress, createProject, deleteProject } from '@/features/projects/service';
import { ValidationError } from '@/features/tasks/service';
import { PROJECT_COLORS } from '@/lib/validation/schemas';
import type { ProjectProgress } from '@/types/domain';

/**
 * Projects.
 *
 * A flat list of progress cards, plus create and delete. There is no nesting: the spec keeps
 * projects a single level so the picker stays simple, and a tree would add query complexity for
 * little benefit at this scale.
 *
 * Deleting a project is destructive and the spec requires an explicit decision about its tasks, so
 * the delete dialog carries that choice rather than defaulting silently. The two options map
 * directly to `deleteProject`'s `taskHandling` parameter: detach keeps the tasks (default, because
 * losing a container is less damaging than losing its contents) and delete-tasks removes them too.
 */

type DeleteState = {
  project: ProjectProgress;
  taskHandling: 'detach' | 'delete-tasks';
};

export default function ProjectsPage() {
  const userId = useActiveUserId();
  const databaseReady = useDatabaseReady();
  const { toast } = useToast();

  const result = useLiveQuery(
    async () => {
      try {
        return { progress: await computeProjectProgress({ userId }), error: null as Error | null };
      } catch (caught) {
        return {
          progress: null,
          error: caught instanceof Error ? caught : new Error('Could not read your projects'),
        };
      }
    },
    [userId],
    undefined,
  );

  const progress = result?.progress ?? null;
  const error = result?.error ?? null;
  const isLoading = !databaseReady || result === undefined;

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Group related tasks. Each project gets a colour that appears on its tasks."
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            // Disabled while loading so a user cannot create against an account whose data has not
            // yet resolved, which would land the project in a half-loaded view.
            disabled={isLoading}
          >
            <FolderPlus aria-hidden="true" className="h-4 w-4" />
            New project
          </Button>
        }
      />

      <PageContent>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <StatsSkeleton cards={6} />
          </div>
        ) : error ? (
          <ErrorState
            title="Could not load your projects"
            description="Your projects and tasks are stored on this device and are unaffected. Reloading usually clears this."
            onRetry={() => window.location.reload()}
          />
        ) : !progress || progress.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="A project gives a set of tasks a shared colour and a progress bar. Create one to start grouping your work."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                Create your first project
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {progress.map((entry) => (
              <li key={entry.project.id} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: entry.project.color }}
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  />
                  <Link
                    href={`/projects/${entry.project.id}`}
                    className="min-w-0 flex-1 text-title text-ink transition-colors duration-hover hover:text-accent"
                  >
                    <span className="block truncate">{entry.project.name}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleteState({ project: entry, taskHandling: 'detach' })}
                    aria-label={`Delete project ${entry.project.name}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-hover hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="tabular text-body text-ink-secondary">
                    {entry.completed} / {entry.total} done
                  </span>
                  <span className="tabular text-body font-medium text-ink">
                    {/* A project with no tasks has no percentage yet. */}
                    {entry.percentage === null ? '—' : `${entry.percentage}%`}
                  </span>
                </div>

                <ProgressBar percentage={entry.percentage} color={entry.project.color} />
              </li>
            ))}
          </ul>
        )}
      </PageContent>

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        userId={userId}
        onCreated={(name) => {
          setCreateOpen(false);
          toast(`Project “${name}” created.`, { tone: 'success' });
        }}
        onError={(message) => toast(message, { tone: 'danger' })}
      />

      <DeleteProjectDialog
        state={deleteState}
        busy={busy}
        onTaskHandlingChange={(taskHandling) =>
          setDeleteState((current) => (current ? { ...current, taskHandling } : current))
        }
        onClose={() => setDeleteState(null)}
        onConfirm={async () => {
          if (!deleteState) return;
          setBusy(true);

          try {
            const outcome = await deleteProject(
              { userId },
              deleteState.project.project.id,
              deleteState.taskHandling,
            );

            const summary =
              deleteState.taskHandling === 'delete-tasks'
                ? `Project deleted with ${outcome.deleted} ${outcome.deleted === 1 ? 'task' : 'tasks'}.`
                : `Project deleted. ${outcome.detached} ${outcome.detached === 1 ? 'task was' : 'tasks were'} moved to your inbox.`;

            toast(summary, { tone: 'success' });
            setDeleteState(null);
          } catch {
            toast('Could not delete the project. Your tasks are unchanged on this device.', { tone: 'danger' });
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/** A real progress bar, not a colour-only status. Height and width carry the value; text carries it too. */
function ProgressBar({ percentage, color }: { percentage: number | null; color: string }) {
  const width = percentage === null ? 0 : Math.max(0, Math.min(100, percentage));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage ?? undefined}
      aria-label={percentage === null ? 'No tasks yet' : `${percentage}% complete`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      <div
        className="h-full rounded-full transition-[width] duration-enter"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  );
}

function CreateProjectDialog({
  open,
  onClose,
  userId,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  onCreated: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PROJECT_COLORS[0]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFieldError(null);

    try {
      await createProject({ userId }, { name: name.trim(), description: null, color });
      onCreated(name.trim());
      setName('');
      setColor(PROJECT_COLORS[0]);
    } catch (caught) {
      if (caught instanceof ValidationError) {
        setFieldError(caught.fieldErrors.name ?? caught.fieldErrors._form ?? 'Check the project details.');
      } else {
        onError('Could not create the project. Your other projects are unaffected.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New project"
      description="A project groups tasks and gives them a colour on the list."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit(new Event('submit') as unknown as FormEvent)}
            loading={busy}
            disabled={name.trim().length === 0}
          >
            Create project
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldError ?? undefined}
          maxLength={120}
          placeholder="e.g. Side project, Home, Team backlog"
          autoFocus
        />

        <Select label="Colour" value={color} onChange={(event) => setColor(event.target.value)}>
          {PROJECT_COLORS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>

        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLORS.map((value) => (
            <span
              key={value}
              aria-hidden="true"
              style={{ backgroundColor: value }}
              className={`h-5 w-5 rounded-full ${value === color ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink' : ''}`}
            />
          ))}
        </div>

        {/* The submit button in the footer is the primary one; this hidden one lets Enter submit the form. */}
        <button type="submit" className="sr-only" tabIndex={-1}>
          Create
        </button>
      </form>
    </Dialog>
  );
}

function DeleteProjectDialog({
  state,
  busy,
  onTaskHandlingChange,
  onClose,
  onConfirm,
}: {
  state: DeleteState | null;
  busy: boolean;
  onTaskHandlingChange: (taskHandling: 'detach' | 'delete-tasks') => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={state !== null}
      onClose={onClose}
      title={state ? `Delete “${state.project.project.name}”?` : 'Delete project?'}
      description={
        state
          ? state.taskHandling === 'delete-tasks'
            ? `This removes the project and soft-deletes ${state.project.total} ${state.project.total === 1 ? 'task' : 'tasks'}. They will be removed from your other devices when you are online.`
            : `This removes the project. ${state.project.total} ${state.project.total === 1 ? 'task will become unparented' : 'tasks will become unparented'} and appear in your inbox.`
          : ''
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void onConfirm()}
            loading={busy}
            disabled={busy}
          >
            {state?.taskHandling === 'delete-tasks' ? 'Delete project and tasks' : 'Delete project only'}
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-meta font-medium text-ink-secondary">
          What should happen to the tasks in this project?
        </legend>

        <label className="flex items-start gap-2 rounded-control border border-line bg-surface p-3">
          <input
            type="radio"
            name="task-handling"
            value="detach"
            checked={state?.taskHandling === 'detach'}
            onChange={() => onTaskHandlingChange('detach')}
            className="mt-0.5 text-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-body font-medium text-ink">Keep the tasks</span>
            <span className="text-meta text-ink-muted">
              Tasks lose their project and move to your inbox. Safer — you do not lose any work.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 rounded-control border border-line bg-surface p-3">
          <input
            type="radio"
            name="task-handling"
            value="delete-tasks"
            checked={state?.taskHandling === 'delete-tasks'}
            onChange={() => onTaskHandlingChange('delete-tasks')}
            className="mt-0.5 text-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-body font-medium text-ink">Delete the tasks too</span>
            <span className="text-meta text-ink-muted">
              Every task in this project is removed as well. Use this only when discarding the whole effort.
            </span>
          </span>
        </label>
      </fieldset>
    </Dialog>
  );
}
