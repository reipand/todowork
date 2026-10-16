import {
  encodeRowForStorage,
  getDatabase,
  liveChildRows,
  liveRowsFor,
  type LocalTag,
} from '@/lib/db/schema';
import { nowIsoSafe, newId } from '@/lib/db/helpers';
import { buildMutation, supersedePendingMutations, writeTagWithMutation } from '@/lib/db/repositories';
import { createTagInputSchema, formatZodErrors, type CreateTagInput } from '@/lib/validation/schemas';
import { ValidationError, type TaskServiceContext } from '@/features/tasks/service';

/**
 * Tag service.
 *
 * Tag names are unique per account, case-insensitively. The database enforces this with a partial
 * unique index, but the check is duplicated here so the user gets a clear message instead of a
 * raw constraint violation after a failed upload. Both layers exist on purpose: the client copy is
 * for the message, the index is for the guarantee.
 */

export async function createTag(ctx: TaskServiceContext, input: CreateTagInput): Promise<LocalTag> {
  const parsed = createTagInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(formatZodErrors(parsed.error));
  }

  const data = parsed.data;

  const existing = await findTagByName(ctx, data.name);
  if (existing) {
    throw new ValidationError({ name: 'A tag with this name already exists' });
  }

  const id = newId();
  const timestamp = nowIsoSafe();

  const tag: LocalTag = {
    id,
    user_id: ctx.userId,
    name: data.name,
    color: data.color,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    revision: 0,
    sync_state: 'pending',
    local_updated_at: timestamp,
  };

  const mutation = buildMutation(ctx.userId, {
    entityType: 'tag',
    entityId: id,
    operation: 'create',
    payload: { id, name: tag.name, color: tag.color },
    baseRevision: null,
  });

  await writeTagWithMutation(tag, mutation);
  return tag;
}

export async function updateTag(
  ctx: TaskServiceContext,
  tagId: string,
  patch: { name?: string; color?: string },
): Promise<LocalTag> {
  const db = getDatabase();
  const existing = await db.tags.get(tagId);

  if (!existing || existing.user_id !== ctx.userId) {
    throw new ValidationError({ _form: 'This tag no longer exists.' });
  }

  if (patch.name !== undefined) {
    const duplicate = await findTagByName(ctx, patch.name);
    if (duplicate && duplicate.id !== tagId) {
      throw new ValidationError({ name: 'A tag with this name already exists' });
    }
  }

  const timestamp = nowIsoSafe();
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.color !== undefined) payload.color = patch.color;

  const updated: LocalTag = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
  };

  await supersedePendingMutations(tagId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'tag',
    entityId: tagId,
    operation: 'update',
    payload,
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeTagWithMutation(updated, mutation);
  return updated;
}

/**
 * Soft-deletes a tag and removes its task links.
 *
 * Links are hard-deleted locally because the join table carries no tombstone; the server removes
 * them by foreign-key cascade when the tag row is eventually purged. Detaching them immediately
 * keeps the task list's tag chips accurate without waiting for a round-trip.
 */
export async function deleteTag(ctx: TaskServiceContext, tagId: string): Promise<void> {
  const db = getDatabase();
  const existing = await db.tags.get(tagId);

  if (!existing || existing.user_id !== ctx.userId) return;

  const timestamp = nowIsoSafe();

  const tombstoned: LocalTag = {
    ...existing,
    deleted_at: timestamp,
    updated_at: timestamp,
    local_updated_at: timestamp,
    sync_state: 'pending',
  };

  await supersedePendingMutations(tagId, ['update']);

  const mutation = buildMutation(ctx.userId, {
    entityType: 'tag',
    entityId: tagId,
    operation: 'delete',
    payload: { id: tagId, deleted_at: timestamp },
    baseRevision: existing.revision > 0 ? existing.revision : null,
  });

  await writeTagWithMutation(tombstoned, mutation);

  // Links to the deleted tag are tombstoned and queued, not hard-deleted. A bare local delete would
  // leave the server links in place, and the next pull on another device would restore a tag that
  // no longer exists here.
  const links = await liveChildRows(db.taskTags, 'tag_id', tagId);

  if (links.length === 0) return;

  await db.transaction('rw', db.taskTags, db.mutations, async () => {
    for (const link of links) {
      await db.taskTags.put(
        encodeRowForStorage({
          ...link,
          deleted_at: timestamp,
          updated_at: timestamp,
          sync_state: 'pending',
        }),
      );

      await db.mutations.add(
        buildMutation(ctx.userId, {
          entityType: 'task_tag',
          entityId: link.id,
          operation: 'delete',
          payload: { id: link.id, deleted_at: timestamp },
          baseRevision: link.revision > 0 ? link.revision : null,
        }),
      );
    }
  });
}

export async function listTags(ctx: TaskServiceContext): Promise<LocalTag[]> {
  const db = getDatabase();
  const tags = await liveRowsFor(db.tags, ctx.userId);
  return tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

async function findTagByName(ctx: TaskServiceContext, name: string): Promise<LocalTag | undefined> {
  const db = getDatabase();
  const tags = await liveRowsFor(db.tags, ctx.userId);
  const normalised = name.trim().toLowerCase();
  return tags.find((tag) => tag.name.trim().toLowerCase() === normalised);
}
