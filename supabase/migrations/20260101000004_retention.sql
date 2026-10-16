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
