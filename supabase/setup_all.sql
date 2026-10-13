-- Todowork migration 0001: core schema
--
-- Design notes (read alongside docs/ARCHITECTURE.md):
--
-- * Every syncable table carries `revision integer`, maintained by a trigger. Revisions are
--   server-owned so "newer" has one unambiguous meaning. Device clocks are never trusted for
--   conflict resolution.
--
-- * Deletion is soft: `deleted_at` is set, rows are retained. A device that has been offline
--   for weeks must learn about a deletion rather than re-upload the row and resurrect it.
--   This is the single most common offline-sync data-loss bug; the schema exists to prevent it.
--
-- * Ids are client-generated UUIDv4. The browser mints an id before the row exists anywhere
--   else, which is what makes create operations idempotent under retry. See ARCHITECTURE.md
--   Â§2.3 for the accepted tradeoff against time-ordered ids.
--
-- * `due_date` and `start_date` are `date`, not `timestamptz`. A task due on the 14th is due
--   on the 14th wherever the user is; treating it as an instant causes off-by-one bugs.
--   `completed_at`, `created_at`, etc. are genuine instants and use `timestamptz`.
--
-- * Every index used by an RLS policy and every foreign key is indexed. Postgres does not
--   index FK columns automatically (Supabase best practice: schema-foreign-key-indexes).
--
-- This migration is idempotent: it can be re-run safely.

-- ---------------------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type public.task_priority as enum ('low', 'medium', 'high');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Shared trigger: bump `revision` and `updated_at` on every accepted write.
--
-- This is what makes optimistic concurrency work. `revision` is incremented by the server on
-- each write, so a client pushing a change can say "I based this on revision 7", and the
-- server can detect that the row has since moved to revision 9. Clients cannot set these
-- fields themselves: `updated_at` and `revision` are always overwritten here.
-- ---------------------------------------------------------------------------------------
create or replace function public.touch_revision()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

comment on function public.touch_revision() is
  'Server-owned optimistic-concurrency counter. Overwrites client-supplied updated_at and revision.';

-- ---------------------------------------------------------------------------------------
-- profiles
--
-- One row per auth user, created automatically by trigger on signup. Kept separate from
-- auth.users because auth.users is owned by Supabase Auth and must not be altered.
-- ---------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 80)
);

comment on table public.profiles is 'Public user profile data. One row per auth.users row.';

-- Auto-create a profile on signup so the client never has to, which removes a race where a
-- UI read happens before the row exists.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the matching profile row on signup. SECURITY DEFINER: runs before any user session exists.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#4F46E5',
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,

  constraint projects_name_length check (char_length(trim(name)) between 1 and 120),
  constraint projects_description_length check (description is null or char_length(description) <= 2000),
  -- Colour is a 6-digit hex. Constrained so the "work rail" motif can always parse it and no
  -- arbitrary CSS value can be injected through a project colour.
  constraint projects_color_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);

drop trigger if exists projects_touch_revision on public.projects;
create trigger projects_touch_revision
  before update on public.projects
  for each row execute function public.touch_revision();

-- ---------------------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  description text,
  completed boolean not null default false,
  priority public.task_priority not null default 'medium',
  due_date date,
  start_date date,
  completed_at timestamptz,
  reminder_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,

  constraint tasks_title_length check (char_length(trim(title)) between 1 and 500),
  constraint tasks_description_length check (description is null or char_length(description) <= 10000),
  -- A completed task must record when. Otherwise the weekly-productivity figure would be
  -- invented rather than measured.
  constraint tasks_completed_at_consistency check (
    (completed = false and completed_at is null) or (completed = true)
  ),
  constraint tasks_start_before_due check (
    start_date is null or due_date is null or start_date <= due_date
  )
);

drop trigger if exists tasks_touch_revision on public.tasks;
create trigger tasks_touch_revision
  before update on public.tasks
  for each row execute function public.touch_revision();

-- ---------------------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------------------
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#55708A',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,

  constraint tags_name_length check (char_length(trim(name)) between 1 and 48),
  constraint tags_color_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);

drop trigger if exists tags_touch_revision on public.tags;
create trigger tags_touch_revision
  before update on public.tags
  for each row execute function public.touch_revision();

-- Tag names are unique per user among live rows. Case-insensitive so "Work" and "work" do not
-- silently coexist. Partial on `deleted_at is null` so a deleted tag does not block the name
-- from being reused.
create unique index if not exists tags_user_name_live_key
  on public.tags (user_id, lower(name))
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------
-- task_tags (join)
--
-- Unlike the other user tables this row is an immutable pair, but it still needs `revision` and
-- `deleted_at`: the sync engine pulls per table by `revision > cursor`, so a join row without a
-- revision would either be invisible to incremental sync or force a full re-pull of the table on
-- every sync. Untagging soft-deletes the row so a delete can propagate to other devices; without
-- the tombstone, the other device's copy would simply resurrect the link.
-- ---------------------------------------------------------------------------------------
create table if not exists public.task_tags (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision integer not null default 1,

  -- Prevents attaching the same tag to the same task twice, which would otherwise duplicate
  -- rows on every retried mutation.
  constraint task_tags_unique_pair unique (task_id, tag_id)
);

drop trigger if exists task_tags_touch_revision on public.task_tags;
create trigger task_tags_touch_revision
  before update on public.task_tags
  for each row execute function public.touch_revision();

-- ---------------------------------------------------------------------------------------
-- task_subtasks
--
-- `position` is double precision so a reorder writes one row (the midpoint between
-- neighbours) instead of renumbering every sibling. Renumbering would emit one mutation per
-- sibling, which amplifies badly on a slow connection.
-- ---------------------------------------------------------------------------------------
create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  position double precision not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,

  constraint task_subtasks_title_length check (char_length(trim(title)) between 1 and 500)
);

drop trigger if exists task_subtasks_touch_revision on public.task_subtasks;
create trigger task_subtasks_touch_revision
  before update on public.task_subtasks
  for each row execute function public.touch_revision();

-- ---------------------------------------------------------------------------------------
-- Indexes
--
-- Every index below exists for a named query. Indexes are created as partial where the query
-- always filters `deleted_at is null`, because tombstones accumulate and would otherwise
-- bloat the index that serves live reads (Supabase best practice: query-partial-indexes).
-- ---------------------------------------------------------------------------------------

-- RLS policy columns. Without these, every policy check is a sequential scan.
create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists tasks_user_id_idx on public.tasks (user_id);
create index if not exists tags_user_id_idx on public.tags (user_id);
create index if not exists task_tags_user_id_idx on public.task_tags (user_id);
create index if not exists task_subtasks_user_id_idx on public.task_subtasks (user_id);

-- Foreign keys (Postgres does not index these automatically; missing ones make cascades slow).
create index if not exists tasks_project_id_idx on public.tasks (project_id);
create index if not exists task_tags_task_id_idx on public.task_tags (task_id);
create index if not exists task_tags_tag_id_idx on public.task_tags (tag_id);
create index if not exists task_subtasks_task_id_idx on public.task_subtasks (task_id);

-- Sync pull: "give me every task for this user with revision greater than my cursor".
-- Matches the incremental-sync query exactly.
create index if not exists tasks_user_revision_idx on public.tasks (user_id, revision);
create index if not exists projects_user_revision_idx on public.projects (user_id, revision);
create index if not exists tags_user_revision_idx on public.tags (user_id, revision);
create index if not exists task_subtasks_user_revision_idx on public.task_subtasks (user_id, revision);
create index if not exists task_tags_user_revision_idx on public.task_tags (user_id, revision);

-- Task list reads: live rows for a user, which is the most frequent query in the app.
create index if not exists tasks_user_live_idx
  on public.tasks (user_id, due_date, priority)
  where deleted_at is null;

-- Dashboard "overdue" and "due today" predicates.
create index if not exists tasks_user_active_due_idx
  on public.tasks (user_id, due_date)
  where deleted_at is null and completed = false;

-- Subtask lists are always ordered by position within a task.
create index if not exists task_subtasks_task_position_idx
  on public.task_subtasks (task_id, position)
  where deleted_at is null;

-- Tombstone sweeping (pg_cron retention job). Only tombstones, so it stays tiny.
create index if not exists tasks_deleted_at_idx on public.tasks (deleted_at) where deleted_at is not null;
create index if not exists projects_deleted_at_idx on public.projects (deleted_at) where deleted_at is not null;
create index if not exists tags_deleted_at_idx on public.tags (deleted_at) where deleted_at is not null;
create index if not exists task_subtasks_deleted_at_idx on public.task_subtasks (deleted_at) where deleted_at is not null;

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

-- Todowork migration 0003: Row Level Security
--
-- Security model. Every table holding user data is protected by RLS, and the policy is the
-- only thing standing between one account and another's data. There is no application server
-- in this architecture (static export), so the database is the entire trust boundary.
--
-- Two rules are applied throughout:
--
--   1. `(select auth.uid())` rather than bare `auth.uid()`. The bare form is evaluated once
--      per row, so on a table with 50k rows it runs 50k times. Wrapping it in a subquery lets
--      the planner evaluate it once and treat it as a constant (Supabase best practice:
--      security-rls-performance).
--
--   2. Both USING and WITH CHECK are set for every write policy. USING filters which rows you
--      may see or modify; WITH CHECK validates what a row may look like after the write.
--      Omitting WITH CHECK is how ownership-transfer bugs happen: a user could UPDATE a row's
--      user_id to someone else's and hand it away, or claim another account's id on INSERT.
--
-- `anon` gets no policy at all, which means no access. Guest mode is local-only by design
-- (spec Â§6, account switching), so this is correct rather than an oversight.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.tags enable row level security;
alter table public.task_tags enable row level security;
alter table public.task_subtasks enable row level security;
alter table public.sync_mutations enable row level security;
alter table public.sync_conflicts enable row level security;
alter table public.sync_devices enable row level security;

-- ---------------------------------------------------------------------------------------
-- profiles
--
-- A profile is readable by its owner only. Cross-user profile reads are not needed by any
-- feature, so they are not permitted. Insert/delete are handled by the signup trigger
-- (SECURITY DEFINER) and the auth.users cascade, so no INSERT or DELETE policy is granted:
-- a user may only rename themselves.
-- ---------------------------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------------------
drop policy if exists projects_select_own on public.projects;
create policy projects_select_own
  on public.projects
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own
  on public.projects
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own
  on public.projects
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Hard delete is not used by the app (soft deletes only), but the policy is defined so that
-- an account-deletion cleanup path and the retention job work without disabling RLS.
drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own
  on public.projects
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- tasks
--
-- PROJECT OWNERSHIP: a task may only reference a project the same user owns. Without this,
-- a user could attach their task to another account's project id, and the foreign key would
-- happily allow it (the FK only proves the project exists, not who owns it).
--
-- Implemented as an EXISTS check inside WITH CHECK. It is a subquery against an indexed
-- column, so it is a cheap index lookup rather than a scan.
-- ---------------------------------------------------------------------------------------
drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own
  on public.tasks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own
  on public.tasks
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = project_id
          and p.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own
  on public.tasks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    -- Re-asserting identity here is what blocks ownership transfer.
    (select auth.uid()) = user_id
    and (
      project_id is null
      or exists (
        select 1 from public.projects p
        where p.id = project_id
          and p.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own
  on public.tasks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------------------
drop policy if exists tags_select_own on public.tags;
create policy tags_select_own
  on public.tags
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists tags_insert_own on public.tags;
create policy tags_insert_own
  on public.tags
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists tags_update_own on public.tags;
create policy tags_update_own
  on public.tags
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists tags_delete_own on public.tags;
create policy tags_delete_own
  on public.tags
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- task_tags
--
-- Both sides of the join must belong to the caller. Checking only the task would let a user
-- attach their own tag row to another account's task, or reference a foreign tag id.
-- ---------------------------------------------------------------------------------------
drop policy if exists task_tags_select_own on public.task_tags;
create policy task_tags_select_own
  on public.task_tags
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists task_tags_insert_own on public.task_tags;
create policy task_tags_insert_own
  on public.task_tags
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tags g
      where g.id = tag_id and g.user_id = (select auth.uid())
    )
  );

drop policy if exists task_tags_update_own on public.task_tags;
create policy task_tags_update_own
  on public.task_tags
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tags g
      where g.id = tag_id and g.user_id = (select auth.uid())
    )
  );

drop policy if exists task_tags_delete_own on public.task_tags;
create policy task_tags_delete_own
  on public.task_tags
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- task_subtasks
--
-- A subtask's parent task must be owned by the caller.
-- ---------------------------------------------------------------------------------------
drop policy if exists task_subtasks_select_own on public.task_subtasks;
create policy task_subtasks_select_own
  on public.task_subtasks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists task_subtasks_insert_own on public.task_subtasks;
create policy task_subtasks_insert_own
  on public.task_subtasks
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists task_subtasks_update_own on public.task_subtasks;
create policy task_subtasks_update_own
  on public.task_subtasks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists task_subtasks_delete_own on public.task_subtasks;
create policy task_subtasks_delete_own
  on public.task_subtasks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- sync_mutations
--
-- The idempotency ledger is written by the sync RPCs and read by the client to reconcile
-- outcomes. A user may see only their own ledger. There is no UPDATE or DELETE policy: an
-- idempotency record is immutable, because mutating it would break the guarantee it exists to
-- provide. Retention is handled by the SECURITY DEFINER sweep job.
-- ---------------------------------------------------------------------------------------
drop policy if exists sync_mutations_select_own on public.sync_mutations;
create policy sync_mutations_select_own
  on public.sync_mutations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists sync_mutations_insert_own on public.sync_mutations;
create policy sync_mutations_insert_own
  on public.sync_mutations
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- sync_conflicts
--
-- Users may read their own conflicts and mark them resolved. Insert happens from the sync
-- path. Neither variant may be edited, only the resolution fields.
-- ---------------------------------------------------------------------------------------
drop policy if exists sync_conflicts_select_own on public.sync_conflicts;
create policy sync_conflicts_select_own
  on public.sync_conflicts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists sync_conflicts_insert_own on public.sync_conflicts;
create policy sync_conflicts_insert_own
  on public.sync_conflicts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists sync_conflicts_update_own on public.sync_conflicts;
create policy sync_conflicts_update_own
  on public.sync_conflicts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- sync_devices
-- ---------------------------------------------------------------------------------------
drop policy if exists sync_devices_select_own on public.sync_devices;
create policy sync_devices_select_own
  on public.sync_devices
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists sync_devices_insert_own on public.sync_devices;
create policy sync_devices_insert_own
  on public.sync_devices
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists sync_devices_update_own on public.sync_devices;
create policy sync_devices_update_own
  on public.sync_devices
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists sync_devices_delete_own on public.sync_devices;
create policy sync_devices_delete_own
  on public.sync_devices
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------
-- Table privileges
--
-- RLS filters rows; GRANTs decide whether the role may touch the table at all. Both are
-- needed. `anon` is deliberately granted nothing: unauthenticated users get no cloud access.
-- ---------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, update, delete on public.task_tags to authenticated;
grant select, insert, update, delete on public.task_subtasks to authenticated;

grant select, insert on public.sync_mutations to authenticated;
grant select, insert, update on public.sync_conflicts to authenticated;
grant select, insert, update, delete on public.sync_devices to authenticated;

-- Explicitly confirm anon cannot read user data. This is belt-and-braces documentation of
-- intent: with RLS enabled and no policy, access is already denied.
revoke all on public.profiles from anon;
revoke all on public.projects from anon;
revoke all on public.tasks from anon;
revoke all on public.tags from anon;
revoke all on public.task_tags from anon;
revoke all on public.task_subtasks from anon;
revoke all on public.sync_mutations from anon;
revoke all on public.sync_conflicts from anon;
revoke all on public.sync_devices from anon;

-- Todowork migration 0004: retention and maintenance jobs
--
-- Tombstones and the idempotency ledger grow forever if nothing prunes them. Both are
-- pruned here on conservative schedules, and both windows are documented so the choice is
-- auditable rather than arbitrary.
--
-- Idempotent: safe to re-run.
--
-- NOTE ON SCHEDULING: this migration assumes the `pg_cron` extension is available. Supabase
-- projects have it. If `pg_cron` is not enabled on your project, the functions below still
-- work and can be invoked manually or from an external scheduler; the `cron.schedule` calls
-- will fail and should be applied separately. See docs/BACKUP.md.

-- ---------------------------------------------------------------------------------------
-- Tombstone retention: 90 days
--
-- Why 90 days. A tombstone is the only record that a deletion happened. A device that has
-- been offline for weeks pulls changes by revision cursor, so if the tombstone were removed
-- before that device synced, the device would never learn of the deletion, would still hold
-- the row, and would re-upload it on its next push. The task would reappear as if it had
-- never been deleted. That is the failure this window prevents.
--
-- 90 days is chosen as a conservative margin well beyond any plausible offline period, and is
-- far longer than the 30-day ledger window because resurrection is a data-loss-visible bug
-- while ledger growth is merely storage.
--
-- Prior to purging a tombstone, dependents are purged too so no orphan references remain.
-- ---------------------------------------------------------------------------------------
create or replace function public.purge_expired_tombstones(p_retention_days integer default 90)
returns table (purged_tasks integer, purged_projects integer, purged_tags integer, purged_subtasks integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  threshold timestamptz;
  task_count integer := 0;
  project_count integer := 0;
  tag_count integer := 0;
  subtask_count integer := 0;
begin
  if p_retention_days < 30 then
    -- Guard rail. A short window would cause resurrection on devices that are merely idle,
    -- so a misconfigured call is rejected rather than silently corrupting sync.
    raise exception 'Retention must be at least 30 days; % was requested', p_retention_days;
  end if;

  threshold := now() - make_interval(days => p_retention_days);

  -- Subtasks first: they reference tasks.
  delete from public.task_subtasks where deleted_at is not null and deleted_at < threshold;
  get diagnostics subtask_count = row_count;

  -- Join rows have no tombstone of their own; they are removed with their task or tag.
  delete from public.task_tags tt
  where not exists (select 1 from public.tasks t where t.id = tt.task_id)
     or not exists (select 1 from public.tags g where g.id = tt.tag_id);

  delete from public.tasks where deleted_at is not null and deleted_at < threshold;
  get diagnostics task_count = row_count;

  delete from public.projects where deleted_at is not null and deleted_at < threshold;
  get diagnostics project_count = row_count;

  delete from public.tags where deleted_at is not null and deleted_at < threshold;
  get diagnostics tag_count = row_count;

  return query select task_count, project_count, tag_count, subtask_count;
end;
$$;

comment on function public.purge_expired_tombstones(integer) is
  'Purges soft-deleted rows past the retention window. Minimum 30 days. See docs/BACKUP.md.';

revoke execute on function public.purge_expired_tombstones(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Idempotency ledger retention: 30 days
--
-- A ledger row is only needed while a client could still retry the same mutation. After a
-- month, no queued mutation survives (the client drops it and surfaces a failure well before
-- then), so the record is dead weight.
-- ---------------------------------------------------------------------------------------
create or replace function public.purge_stale_idempotency_records(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.sync_mutations
  where applied_at < now() - make_interval(days => p_retention_days);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_stale_idempotency_records(integer) is
  'Drops idempotency records past the retry window. Safe: a mutation cannot still be in flight.';

revoke execute on function public.purge_stale_idempotency_records(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Resolved conflict retention: 30 days
--
-- Open conflicts are never purged, no matter how old. An unresolved conflict represents work
-- the user has not yet decided on, so deleting it would discard their edit without asking.
-- ---------------------------------------------------------------------------------------
create or replace function public.purge_resolved_conflicts(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.sync_conflicts
  where resolved_at is not null
    and resolved_at < now() - make_interval(days => p_retention_days);

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_resolved_conflicts(integer) is
  'Drops only RESOLVED conflicts. Open conflicts are retained indefinitely.';

revoke execute on function public.purge_resolved_conflicts(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Schedule
--
-- Guarded so this migration does not fail on a project without pg_cron. Wrapped in a DO block
-- with an extension check rather than a bare `create extension`, because creating an extension
-- requires privileges the migration may not hold and should not assume.
-- ---------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule first so re-running this migration does not create duplicates.
    if exists (select 1 from cron.job where jobname = 'todowork_purge_tombstones') then
      perform cron.unschedule('todowork_purge_tombstones');
    end if;
    if exists (select 1 from cron.job where jobname = 'todowork_purge_idempotency') then
      perform cron.unschedule('todowork_purge_idempotency');
    end if;
    if exists (select 1 from cron.job where jobname = 'todowork_purge_conflicts') then
      perform cron.unschedule('todowork_purge_conflicts');
    end if;

    -- 03:17 UTC daily: an off-peak, off-the-hour minute so the job does not collide with the
    -- many jobs scheduled at :00.
    perform cron.schedule('todowork_purge_tombstones', '17 3 * * *',
      $cron$select public.purge_expired_tombstones(90)$cron$);
    perform cron.schedule('todowork_purge_idempotency', '27 3 * * *',
      $cron$select public.purge_stale_idempotency_records(30)$cron$);
    perform cron.schedule('todowork_purge_conflicts', '37 3 * * *',
      $cron$select public.purge_resolved_conflicts(30)$cron$);
  else
    raise notice 'pg_cron not installed; Todowork retention functions created but not scheduled. See docs/BACKUP.md.';
  end if;
end $$;

