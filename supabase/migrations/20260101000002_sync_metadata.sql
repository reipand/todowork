-- Todowork migration 0002: sync metadata
--
-- Three tables, each with one job. No table here exists for its own sake:
--
--   sync_mutations   proves a pushed mutation was already applied, so upload retry is safe
--   sync_conflicts   holds edits that could not be merged, so nothing is silently discarded
--   sync_devices     per-device pull cursor and diagnostics
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------------------
-- sync_mutations
--
-- The idempotency ledger. Every mutation the client pushes carries an `idempotency_key`
-- minted on the device. On a retry (which is expected on mobile networks, and is the normal
-- case rather than an exception), the unique constraint turns the replay into a no-op and the
-- server returns the original outcome instead of applying the change twice.
--
-- This is what makes the aggressive retry strategy in docs/SYNC-CONFLICTS.md safe. Without
-- it, retrying an unacknowledged create would produce duplicate tasks.
--
-- Rows are prunable after the client can no longer plausibly retry (see the retention job in
-- migration 0004). 30 days is far beyond any realistic retry window.
-- ---------------------------------------------------------------------------------------
create table if not exists public.sync_mutations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key text not null,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null,
  -- The outcome of the original application, replayed verbatim for duplicate requests.
  result_revision integer,
  applied_at timestamptz not null default now(),

  constraint sync_mutations_key_unique unique (user_id, idempotency_key),
  constraint sync_mutations_key_length check (char_length(idempotency_key) between 8 and 128),
  constraint sync_mutations_entity_type_valid check (
    entity_type in ('task', 'project', 'tag', 'subtask', 'task_tag')
  ),
  constraint sync_mutations_operation_valid check (
    operation in ('create', 'update', 'delete')
  )
);

comment on table public.sync_mutations is
  'Idempotency ledger for client mutations. A duplicate key means the write already happened.';

create index if not exists sync_mutations_user_id_idx on public.sync_mutations (user_id);
-- Supports the retention sweep by age.
create index if not exists sync_mutations_applied_at_idx on public.sync_mutations (applied_at);

-- ---------------------------------------------------------------------------------------
-- sync_conflicts
--
-- Written when two devices edit the same field of the same row to different values and the
-- edit cannot be merged automatically. Both variants are stored so the user can choose, and
-- so a genuinely irreconcilable edit never results in silent data loss.
--
-- The server keeps its own version in the entity row and returns 409 to the client. The
-- client stores a local mirror of this record for the resolution UI; this table is the
-- authoritative copy.
-- ---------------------------------------------------------------------------------------
create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  -- Comma-separated list of field names that could not be merged.
  conflicting_fields text not null,
  -- JSON snapshots of both sides at detection time.
  local_payload jsonb not null,
  remote_payload jsonb not null,
  -- Revision the server held when the conflict was recorded, for the resolution UI.
  server_revision integer not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- Records which variant the user ultimately chose, for auditability.
  resolution text,

  constraint sync_conflicts_entity_type_valid check (
    entity_type in ('task', 'project', 'tag', 'subtask', 'task_tag')
  ),
  constraint sync_conflicts_resolution_valid check (
    resolution is null or resolution in ('local', 'remote', 'merged')
  )
);

comment on table public.sync_conflicts is
  'Unmergeable concurrent edits. Both variants retained; resolved explicitly by the user.';

create index if not exists sync_conflicts_user_id_idx on public.sync_conflicts (user_id);
-- The resolution UI lists unresolved conflicts for the signed-in user, newest first.
create index if not exists sync_conflicts_open_idx
  on public.sync_conflicts (user_id, detected_at desc)
  where resolved_at is null;

-- ---------------------------------------------------------------------------------------
-- sync_devices
--
-- Pull cursor per device. Each device tracks the highest server revision it has fully
-- pulled, which is what makes incremental sync possible: "send me everything above N".
--
-- Scoped per device rather than per user so a device that has been offline does not force
-- another device to re-download, and so a fresh install starts from revision 0 cleanly.
-- ---------------------------------------------------------------------------------------
create table if not exists public.sync_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null,
  -- Human-readable label for the Settings > Sync screen.
  device_label text,
  platform text,
  last_pulled_revision integer not null default 0,
  last_push_at timestamptz,
  last_pull_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sync_devices_unique_device unique (user_id, device_id),
  constraint sync_devices_device_id_length check (char_length(device_id) between 4 and 128),
  constraint sync_devices_platform_valid check (
    platform is null or platform in ('web', 'pwa', 'android', 'ios')
  )
);

create index if not exists sync_devices_user_id_idx on public.sync_devices (user_id);

-- ---------------------------------------------------------------------------------------
-- Server-side conflict detection support
--
-- A helper that performs an optimistic-concurrency write. It is defined here rather than in
-- the client so the check is atomic: a read-then-write from the client would race two devices
-- and let one overwrite the other without noticing.
--
-- Returns the new revision on success. Returns NULL when the caller's base_revision is stale,
-- which the caller must treat as a conflict, not as an error to retry blindly.
-- ---------------------------------------------------------------------------------------
create or replace function public.check_revision(
  p_table regclass,
  p_id uuid,
  p_base_revision integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision integer;
  owner_id uuid;
begin
  -- SECURITY DEFINER bypasses RLS inside the function, so identity must be verified here
  -- explicitly. Without this, the function would be a way to probe rows across accounts.
  execute format('select revision, user_id from %s where id = $1', p_table)
    into current_revision, owner_id
    using p_id;

  if owner_id is null or owner_id <> (select auth.uid()) then
    -- Treat a row that is not yours exactly like a row that does not exist. Returning the
    -- same answer for both avoids leaking whether another account's row id is real.
    return false;
  end if;

  -- No base revision supplied means the client had no prior version (a fresh create), so
  -- any existing row is a genuine conflict.
  return current_revision = p_base_revision;
end;
$$;

comment on function public.check_revision(regclass, uuid, integer) is
  'Atomic optimistic-concurrency check. Verifies ownership because SECURITY DEFINER bypasses RLS.';

-- EXECUTE is revoked broadly: this is an internal helper used by policies and RPCs, not a
-- public API. Leaving it open to `anon` would allow unauthenticated probing.
revoke execute on function public.check_revision(regclass, uuid, integer) from public, anon;
grant execute on function public.check_revision(regclass, uuid, integer) to authenticated;
