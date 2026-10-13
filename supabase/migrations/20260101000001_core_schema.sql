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
--   §2.3 for the accepted tradeoff against time-ordered ids.
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
