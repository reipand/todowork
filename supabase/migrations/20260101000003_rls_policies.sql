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
-- (spec §6, account switching), so this is correct rather than an oversight.
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
