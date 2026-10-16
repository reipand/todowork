'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, Calendar, CalendarDays, CalendarPlus, ExternalLink, Flag, FolderKanban, GripVertical, Trash2, X, type LucideIcon } from 'lucide-react';

import { PriorityIndicator, PRIORITY_OPTIONS } from '@/components/ui/priority-indicator';
import { ConfirmDialog } from '@/components/ui/dialog';
import { deleteTask, updateTask, ValidationError } from '@/features/tasks/service';
import {
  createSubtask,
  deleteSubtask,
  listSubtasks,
  reorderSubtask,
  updateSubtask,
} from '@/features/tasks/subtask-service';
import { useToast } from '@/components/ui/toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { cn } from '@/lib/utils';
import { formatFullDate, formatRelativeInstant, isoToLocalDateTimeInput, localDateTimeToIso } from '@/lib/utils/date';
import { downloadICS, generateICS, googleCalendarUrl, hasCalendarEvent } from '@/lib/utils/calendar';
import type { Priority, TaskWithRelations } from '@/types/domain';

/**
 * Task detail panel.
 *
 * Edits are saved per field, immediately, with no Save button. The reason is that the local write is
 * instant and offline-safe, so a save button would introduce a failure mode (unsaved work lost when
 * the panel closes) to protect against a risk that does not exist here.
 *
 * Text fields debounce their write so typing does not queue one mutation per keystroke. Selects and the
 * date input write on change, since each is a single deliberate act.
 *
 * Subtasks are managed inline, using midpoint ordering so a reorder is one write.
 */

export interface TaskDetailPanelProps {
  task: TaskWithRelations;
  userId: string;
  projects: Array<{ id: string; name: string; color: string }>;
  onClose: () => void;
  onDeleted: () => void;
}

export function TaskDetailPanel({
  task,
  userId,
  projects,
  onClose,
  onDeleted,
}: TaskDetailPanelProps) {
  const { toast } = useToast();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Drag-to-reorder state. Uses native HTML5 DnD; no library needed for a flat list.
  const [draggedSubtask, setDraggedSubtask] = useState<string | null>(null);
  const [dragOverSubtask, setDragOverSubtask] = useState<string | null>(null);

  // Inline subtask title edit state.
  const [editingSubtask, setEditingSubtask] = useState<string | null>(null);
  const [subtaskEditTitle, setSubtaskEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Reset local field state when the panel switches to a different task. Without this, editing task A
  // and then opening task B would briefly show A's text in B's fields.
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setFieldError(null);
  }, [task.id, task.title, task.description]);

  const subtasks = useLiveQuery(
    () => listSubtasks({ userId }, task.id),
    [userId, task.id],
    [],
  );

  /**
   * Debounced title save.
   *
   * 500ms is chosen against the local write being instant: the delay exists only to collapse a typing
   * burst into one queued mutation, not to protect the database.
   */
  useEffect(() => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || trimmed === task.title) return;

    const timer = setTimeout(() => {
      void updateTask({ userId }, task.id, { title: trimmed }).catch((caught: unknown) => {
        if (caught instanceof ValidationError) {
          setFieldError(caught.fieldErrors.title ?? 'Check the title.');
        } else {
          toast('Could not save the title.', { tone: 'danger' });
        }
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [title, task.title, task.id, userId, toast]);

  useEffect(() => {
    const trimmed = description.trim();
    const nextDescription = trimmed.length === 0 ? null : description;
    if (nextDescription === task.description) return;

    const timer = setTimeout(() => {
      void updateTask({ userId }, task.id, { description: nextDescription }).catch(() => {
        toast('Could not save the notes.', { tone: 'danger' });
      });
    }, 600);

    return () => clearTimeout(timer);
  }, [description, task.description, task.id, userId, toast]);

  const applyPatch = (patch: Parameters<typeof updateTask>[2], failureMessage: string): void => {
    void updateTask({ userId }, task.id, patch).catch((caught: unknown) => {
      if (caught instanceof ValidationError) {
        setFieldError(Object.values(caught.fieldErrors)[0] ?? 'Check the task details.');
      } else {
        toast(failureMessage, { tone: 'danger' });
      }
    });
  };

  const handleDelete = (): void => {
    setConfirmDeleteOpen(false);
    void deleteTask({ userId }, task.id)
      .then(() => {
        // A completed delete is confirmed with an undo-less toast. Undo is deliberately not offered:
        // the tombstone would have to be reversed across devices, and a partial undo is worse than none.
        toast('Task deleted.', { tone: 'success' });
        onDeleted();
      })
      .catch(() => toast('Could not delete this task.', { tone: 'danger' }));
  };

  const handleAddSubtask = (): void => {
    const trimmed = newSubtaskTitle.trim();
    if (trimmed.length === 0) return;

    void createSubtask({ userId }, { task_id: task.id, title: trimmed })
      .then(() => setNewSubtaskTitle(''))
      .catch(() => toast('Could not add the checklist item.', { tone: 'danger' }));
  };

  // --- Drag-to-reorder ---------------------------------------------------------
  // Native HTML5 DnD on a flat list. On drop, we compute the before/after neighbours
  // of the target slot and delegate to reorderSubtask, which writes a single midpoint
  // position. The service handles precision exhaustion internally.

  const handleDragStart = (event: React.DragEvent<HTMLLIElement>, subtaskId: string): void => {
    setDraggedSubtask(subtaskId);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox requires setData to start a drag; the data itself is unused.
    event.dataTransfer.setData('text/plain', subtaskId);
  };

  const handleDragOver = (event: React.DragEvent<HTMLLIElement>, subtaskId: string): void => {
    if (draggedSubtask === null || draggedSubtask === subtaskId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverSubtask(subtaskId);
  };

  const handleDrop = (event: React.DragEvent<HTMLLIElement>, targetId: string): void => {
    event.preventDefault();
    if (!draggedSubtask || draggedSubtask === targetId) {
      setDraggedSubtask(null);
      setDragOverSubtask(null);
      return;
    }

    const draggedIndex = subtasks.findIndex((s) => s.id === draggedSubtask);
    const targetIndex = subtasks.findIndex((s) => s.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedSubtask(null);
      setDragOverSubtask(null);
      return;
    }

    // Compute the neighbours of the insertion slot.
    let beforeId: string | null;
    let afterId: string | null;

    if (draggedIndex < targetIndex) {
      // Moving down: insert after the target.
      beforeId = targetId;
      afterId = subtasks[targetIndex + 1]?.id ?? null;
    } else {
      // Moving up: insert before the target.
      afterId = targetId;
      beforeId = subtasks[targetIndex - 1]?.id ?? null;
    }

    void reorderSubtask({ userId }, task.id, draggedSubtask, beforeId, afterId).catch(() =>
      toast('Could not reorder the checklist.', { tone: 'danger' }),
    );

    setDraggedSubtask(null);
    setDragOverSubtask(null);
  };

  const handleDragEnd = (): void => {
    setDraggedSubtask(null);
    setDragOverSubtask(null);
  };

  // --- Inline subtask title edit ----------------------------------------------

  const startSubtaskEdit = (subtaskId: string, currentTitle: string): void => {
    setEditingSubtask(subtaskId);
    setSubtaskEditTitle(currentTitle);
    // Focus the input on next paint.
    requestAnimationFrame(() => editInputRef.current?.focus());
  };

  const saveSubtaskEdit = (): void => {
    if (!editingSubtask) return;
    const trimmed = subtaskEditTitle.trim();
    if (trimmed.length > 0) {
      void updateSubtask({ userId }, editingSubtask, { title: trimmed }).catch(() =>
        toast('Could not save the checklist item.', { tone: 'danger' }),
      );
    }
    setEditingSubtask(null);
  };

  /**
   * Notion-style: Enter in inline edit saves the current item and focuses the "Add a step"
   * input so the user can immediately type the next one.
   */
  const saveSubtaskEditAndContinue = (): void => {
    saveSubtaskEdit();
    requestAnimationFrame(() => addInputRef.current?.focus());
  };

  /**
   * Notion-style: Backspace on an empty inline-edit deletes the subtask and focuses the
   * "Add a step" input.
   */
  const deleteSubtaskOnEmptyBackspace = (): void => {
    if (!editingSubtask) return;
    if (subtaskEditTitle.trim().length === 0) {
      void deleteSubtask({ userId }, editingSubtask).catch(() =>
        toast('Could not remove the checklist item.', { tone: 'danger' }),
      );
      setEditingSubtask(null);
      requestAnimationFrame(() => addInputRef.current?.focus());
    }
  };

  // --- Calendar export ---------------------------------------------------------

  const icsContent = generateICS(task);
  const googleUrl = googleCalendarUrl(task);
  const completedSubtaskCount = subtasks.filter((s) => s.completed).length;

  return (
    <aside
      // A complementary landmark: it holds detail about the list, not the list itself.
      aria-label="Task details"
      className="flex h-full flex-col border-l border-line bg-surface"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-body font-semibold text-ink">Task details</h2>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            aria-label="Delete task"
            className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors duration-hover hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details"
            className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors duration-hover hover:bg-sunken hover:text-ink"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          {/* Title — large, no label. Like a Notion page title. */}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            aria-invalid={fieldError ? true : undefined}
            aria-label="Task title"
            placeholder="Untitled"
            className="text-title font-semibold text-ink bg-transparent focus:outline-none"
          />
          {fieldError ? (
            <span role="alert" className="text-meta font-medium text-danger">
              {fieldError}
            </span>
          ) : null}

          {/* Property rows — Notion-style key:value pairs with icon + label + value. */}
          <div className="flex flex-col gap-0.5">
            <PropertyRow icon={FolderKanban} label="Project">
              <select
                value={task.project_id ?? ''}
                onChange={(event) =>
                  applyPatch(
                    { project_id: event.target.value || null },
                    'Could not save the project.',
                  )
                }
                aria-label="Project"
                className="h-8 min-w-0 flex-1 rounded-control bg-transparent px-1 text-body text-ink transition-colors duration-hover hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow icon={Flag} label="Priority">
              <div className="flex items-center gap-2">
                <select
                  value={task.priority}
                  onChange={(event) =>
                    applyPatch(
                      { priority: event.target.value as Priority },
                      'Could not save the priority.',
                    )
                  }
                  aria-label="Priority"
                  className="h-8 min-w-0 flex-1 rounded-control bg-transparent px-1 text-body text-ink transition-colors duration-hover hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <PriorityIndicator priority={task.priority} variant="badge" />
              </div>
            </PropertyRow>

            <PropertyRow icon={Calendar} label="Due">
              <input
                type="date"
                value={task.due_date ?? ''}
                onChange={(event) =>
                  applyPatch({ due_date: event.target.value || null }, 'Could not save the due date.')
                }
                aria-label="Due date"
                className="h-8 min-w-0 flex-1 rounded-control bg-transparent px-1 text-body text-ink transition-colors duration-hover hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
              />
            </PropertyRow>

            <PropertyRow icon={CalendarDays} label="Start">
              <input
                type="date"
                value={task.start_date ?? ''}
                onChange={(event) =>
                  applyPatch({ start_date: event.target.value || null }, 'Could not save the start date.')
                }
                aria-label="Start date"
                className="h-8 min-w-0 flex-1 rounded-control bg-transparent px-1 text-body text-ink transition-colors duration-hover hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
              />
            </PropertyRow>

            <PropertyRow icon={Bell} label="Reminder">
              <input
                type="datetime-local"
                value={task.reminder_at ? isoToLocalDateTimeInput(task.reminder_at) : ''}
                onChange={(event) =>
                  applyPatch(
                    { reminder_at: event.target.value ? localDateTimeToIso(event.target.value) : null },
                    'Could not save the reminder.',
                  )
                }
                aria-label="Reminder"
                className="h-8 min-w-0 flex-1 rounded-control bg-transparent px-1 text-body text-ink transition-colors duration-hover hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
              />
            </PropertyRow>
          </div>

          {/* Description — Notion-style page body below properties. */}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={10000}
            placeholder="Add a description…"
            aria-label="Description"
            className="resize-y rounded-control border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
          />

          {hasCalendarEvent(task) ? (
            <section aria-labelledby="calendar-heading" className="flex flex-col gap-2">
              <h3 id="calendar-heading" className="text-meta font-medium text-ink-secondary">
                Add to calendar
              </h3>
              <div className="flex gap-2">
                {icsContent ? (
                  <button
                    type="button"
                    onClick={() => {
                      const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';
                      downloadICS(icsContent, `${slug}.ics`);
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-2.5 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken"
                  >
                    <CalendarPlus aria-hidden="true" className="h-3.5 w-3.5" />
                    Download .ics
                  </button>
                ) : null}
                {googleUrl ? (
                  <a
                    href={googleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-2.5 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken"
                  >
                    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                    Google Calendar
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="subtasks-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 id="subtasks-heading" className="text-meta font-medium text-ink-secondary">
                Checklist
              </h3>
              {subtasks.length > 0 ? (
                <span className="text-meta text-ink-muted tabular">
                  {completedSubtaskCount} of {subtasks.length} completed
                </span>
              ) : null}
            </div>

            {subtasks.length === 0 ? (
              <p className="text-meta text-ink-muted">
                No checklist items yet. Break this task into steps if it helps.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {subtasks.map((subtask) => (
                  <li
                    key={subtask.id}
                    draggable={editingSubtask !== subtask.id}
                    onDragStart={(event) => handleDragStart(event, subtask.id)}
                    onDragOver={(event) => handleDragOver(event, subtask.id)}
                    onDrop={(event) => handleDrop(event, subtask.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      'flex items-center gap-2 rounded-control px-1 py-1 hover:bg-sunken/60',
                      draggedSubtask === subtask.id && 'opacity-40',
                      dragOverSubtask === subtask.id && 'border-t-2 border-accent',
                    )}
                  >
                    <GripVertical
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 cursor-grab text-ink-muted/40"
                    />

                    <input
                      type="checkbox"
                      checked={subtask.completed}
                      onChange={(event) =>
                        void updateSubtask({ userId }, subtask.id, {
                          completed: event.target.checked,
                        }).catch(() => toast('Could not update the checklist item.', { tone: 'danger' }))
                      }
                      aria-label={`Complete ${subtask.title}`}
                      className="h-3.5 w-3.5 shrink-0 rounded border-line-strong text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    />

                    {editingSubtask === subtask.id ? (
                      <input
                        ref={editInputRef}
                        value={subtaskEditTitle}
                        onChange={(event) => setSubtaskEditTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            saveSubtaskEditAndContinue();
                          } else if (event.key === 'Escape') {
                            setEditingSubtask(null);
                          } else if (event.key === 'Backspace' && subtaskEditTitle.length === 0) {
                            event.preventDefault();
                            deleteSubtaskOnEmptyBackspace();
                          }
                        }}
                        onBlur={saveSubtaskEdit}
                        maxLength={500}
                        className="min-w-0 flex-1 rounded-control border border-accent bg-surface px-1.5 text-body text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
                      />
                    ) : (
                      <span
                        onDoubleClick={() => startSubtaskEdit(subtask.id, subtask.title)}
                        title="Double-click to edit"
                        className={cn(
                          'min-w-0 flex-1 truncate text-body',
                          subtask.completed ? 'text-ink-muted line-through' : 'text-ink',
                        )}
                      >
                        {subtask.title}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        void deleteSubtask({ userId }, subtask.id).catch(() =>
                          toast('Could not remove the checklist item.', { tone: 'danger' }),
                        )
                      }
                      aria-label={`Remove ${subtask.title}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted transition-colors duration-hover hover:bg-danger-soft hover:text-danger"
                    >
                      <X aria-hidden="true" className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={addInputRef}
                value={newSubtaskTitle}
                onChange={(event) => setNewSubtaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAddSubtask();
                  }
                }}
                placeholder="Add a step"
                aria-label="Add a checklist item"
                maxLength={500}
                className="h-8 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-2 text-body text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
              />
              <button
                type="button"
                onClick={handleAddSubtask}
                disabled={newSubtaskTitle.trim().length === 0}
                className="h-8 shrink-0 rounded-control border border-line-strong bg-surface px-2.5 text-meta font-medium text-ink transition-colors duration-hover hover:bg-sunken disabled:opacity-45"
              >
                Add step
              </button>
            </div>
          </section>

          <dl className="flex flex-col gap-2 border-t border-line pt-4 text-meta">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Created</dt>
              <dd className="text-ink-secondary">{formatFullDate(task.created_at)}</dd>
            </div>

            {task.completed_at ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Completed</dt>
                <dd className="text-ink-secondary">{formatFullDate(task.completed_at)}</dd>
              </div>
            ) : null}

            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Last changed</dt>
              <dd className="text-ink-secondary">{formatRelativeInstant(task.updated_at)}</dd>
            </div>

            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Sync</dt>
              <dd className="text-ink-secondary">
                {task.sync_state === 'synced'
                  ? 'Synced'
                  : task.sync_state === 'pending'
                    ? 'Waiting to sync'
                    : 'Sync failed'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete this task?"
        description={`"${task.title}" will be removed from this device and from your other devices when you are online. This cannot be undone.`}
        confirmLabel="Delete task"
        tone="danger"
      />
    </aside>
  );
}

/**
 * A Notion-style property row: icon + label + value, arranged horizontally.
 * The value (a select, input, or custom control) fills the remaining width.
 */
function PropertyRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
      <span className="w-16 shrink-0 text-meta text-ink-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Live-subscribes to one task so the panel stays current when sync brings a change.
 *
 * Deliberately delegates to `getTask` rather than re-deriving the joins. An earlier version built
 * the same project/tag/subtask shape inline, which is exactly how the panel and the list drift apart
 * and start disagreeing about what a task contains.
 */
export function useTaskDetail(userId: string, taskId: string | null): TaskWithRelations | null {
  const result = useLiveQuery(
    async () => {
      if (!taskId) return null;
      const { getTask } = await import('@/features/tasks/service');
      return getTask({ userId }, taskId);
    },
    [userId, taskId],
    null,
  );

  return result ?? null;
}
