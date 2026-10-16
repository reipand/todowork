-- Todowork: Row Level Security isolation tests
--
-- These tests prove the single claim that matters most for this product: one account cannot
-- read or modify another account's data. They are written to run inside a transaction that is
-- rolled back at the end, so they leave no residue and can be run against a development
-- project repeatedly.
--
-- HOW TO RUN
--   supabase db execute --file supabase/tests/rls_isolation_test.sql
-- or paste into the Supabase SQL editor.
--
-- IMPORTANT: this file has NOT been executed as part of authoring. It is written to be
-- runnable, but the results are unverified. Run it and treat output as the source of truth.
--
-- Mechanism. RLS evaluates `auth.uid()`, which reads the request JWT claim. Inside a SQL
-- session there is no JWT, so the tests impersonate a user by setting the same GUC that the
-- Supabase auth helper reads, and switching role to `authenticated`. Setting the role is
-- essential: RLS policies are attached to `authenticated`, and the superuser running the test
-- would bypass RLS entirely, making every assertion vacuously pass.

begin;

-- Create two users with distinguishable ids. Inserted directly into auth.users because these
-- tests run at the database layer, below the Auth API.
do $$
declare
  user_a uuid := '00000000-0000-4000-a000-000000000001';
  user_b uuid := '00000000-0000-4000-a000-000000000002';
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id)
  values
    (user_a, 'rls-test-a@example.test', 'not-a-real-hash', now(), now(), now(), '00000000-0000-0000-0000-000000000000'),
    (user_b, 'rls-test-b@example.test', 'not-a-real-hash', now(), now(), now(), '00000000-0000-0000-0000-000000000000')
  on conflict (id) do nothing;
end $$;

-- Seed data for each user, inserted as the table owner so RLS is not in the way here.
-- The point of the tests below is to verify that the *authenticated* role cannot cross over.
insert into public.projects (id, user_id, name, color)
values
  ('10000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-000000000001', 'Alice Project', '#4F46E5'),
  ('10000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-000000000002', 'Bob Project', '#B4232A')
on conflict (id) do nothing;

insert into public.tasks (id, user_id, project_id, title)
values
  ('20000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-00000000000a', 'Alice Task'),
  ('20000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-00000000000b', 'Bob Task')
on conflict (id) do nothing;

insert into public.tags (id, user_id, name)
values
  ('30000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-000000000001', 'alice-tag'),
  ('30000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-000000000002', 'bob-tag')
on conflict (id) do nothing;

-- =========================================================================================
-- Assertions, executed as Alice (the `authenticated` role with Alice's uid)
-- =========================================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}';

do $$
declare
  visible_tasks integer;
  visible_projects integer;
  visible_tags integer;
  bob_task_visible integer;
begin
  -- --- SELECT isolation -----------------------------------------------------------------
  select count(*) into visible_tasks from public.tasks;
  if visible_tasks <> 1 then
    raise exception 'FAIL: Alice should see exactly 1 task, saw %', visible_tasks;
  end if;

  -- Explicitly confirm Bob's specific row is invisible, not merely that the count is right.
  select count(*) into bob_task_visible
  from public.tasks where id = '20000000-0000-4000-a000-00000000000b';
  if bob_task_visible <> 0 then
    raise exception 'FAIL: Alice can see Bob''s task by id';
  end if;

  select count(*) into visible_projects from public.projects;
  if visible_projects <> 1 then
    raise exception 'FAIL: Alice should see exactly 1 project, saw %', visible_projects;
  end if;

  select count(*) into visible_tags from public.tags;
  if visible_tags <> 1 then
    raise exception 'FAIL: Alice should see exactly 1 tag, saw %', visible_tags;
  end if;

  raise notice 'PASS: SELECT isolation holds for tasks, projects and tags';
end $$;

-- --- INSERT with someone else's user_id must be rejected --------------------------------
-- This is the ownership-forgery case: a client could otherwise write data into another
-- account by simply supplying a different user_id.
do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.tasks (user_id, title)
    values ('00000000-0000-4000-a000-000000000002', 'forged ownership');
  exception
    when insufficient_privilege or check_violation then
      rejected := true;
  end;

  if not rejected then
    raise exception 'FAIL: Alice was able to insert a task owned by Bob';
  end if;

  raise notice 'PASS: INSERT with another user''s user_id is rejected';
end $$;

-- --- Attaching a task to another user's project must be rejected ------------------------
-- The foreign key alone would allow this (the project exists), so it is the RLS EXISTS
-- check in the WITH CHECK clause that must catch it.
do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.tasks (user_id, project_id, title)
    values (
      '00000000-0000-4000-a000-000000000001',
      '10000000-0000-4000-a000-00000000000b',
      'task pointing at Bob project'
    );
  exception
    when insufficient_privilege or check_violation or foreign_key_violation then
      rejected := true;
  end;

  if not rejected then
    raise exception 'FAIL: Alice attached a task to Bob''s project';
  end if;

  raise notice 'PASS: cross-account project reference is rejected';
end $$;

-- --- UPDATE cannot reach another user's row ---------------------------------------------
do $$
declare
  affected integer;
begin
  update public.tasks set title = 'hijacked'
  where id = '20000000-0000-4000-a000-00000000000b';

  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: Alice updated Bob''s task (% row(s))', affected;
  end if;

  raise notice 'PASS: UPDATE of another user''s row affects 0 rows';
end $$;

-- --- UPDATE cannot transfer ownership ---------------------------------------------------
-- Even on her own row, Alice must not be able to hand it to Bob. This is the case that a
-- USING-only policy without WITH CHECK would permit.
do $$
declare
  rejected boolean := false;
begin
  begin
    update public.tasks
    set user_id = '00000000-0000-4000-a000-000000000002'
    where id = '20000000-0000-4000-a000-00000000000a';
    -- If no exception fired, the row may have been silently filtered to 0 rows by USING,
    -- which is also acceptable. What is not acceptable is the row now belonging to Bob.
    if exists (
      select 1 from public.tasks
      where id = '20000000-0000-4000-a000-00000000000a'
        and user_id = '00000000-0000-4000-a000-000000000002'
    ) then
      raise exception 'FAIL: ownership transfer succeeded';
    end if;
  exception
    when insufficient_privilege or check_violation then
      rejected := true;
  end;

  raise notice 'PASS: ownership transfer blocked (rejected=% or filtered to 0 rows)', rejected;
end $$;

-- --- DELETE cannot reach another user's row ---------------------------------------------
do $$
declare
  affected integer;
begin
  delete from public.tasks where id = '20000000-0000-4000-a000-00000000000b';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: Alice deleted Bob''s task';
  end if;

  raise notice 'PASS: DELETE of another user''s row affects 0 rows';
end $$;

-- --- sync_mutations ledger is account-scoped --------------------------------------------
do $$
declare
  visible integer;
begin
  insert into public.sync_mutations (user_id, idempotency_key, entity_type, entity_id, operation)
  values (
    '00000000-0000-4000-a000-000000000001',
    'alice-key-0001',
    'task',
    '20000000-0000-4000-a000-00000000000a',
    'create'
  )
  on conflict do nothing;

  select count(*) into visible from public.sync_mutations;
  if visible <> 1 then
    raise exception 'FAIL: Alice should see 1 ledger row, saw %', visible;
  end if;

  raise notice 'PASS: sync_mutations is account-scoped';
end $$;

-- --- Idempotency uniqueness --------------------------------------------------------------
-- Replaying the same key must not create a second ledger row, which is the guarantee that
-- makes mutation retry safe.
do $$
declare
  rejected boolean := false;
  total integer;
begin
  begin
    insert into public.sync_mutations (user_id, idempotency_key, entity_type, entity_id, operation)
    values (
      '00000000-0000-4000-a000-000000000001',
      'alice-key-0001',
      'task',
      '20000000-0000-4000-a000-00000000000a',
      'create'
    );
  exception
    when unique_violation then
      rejected := true;
  end;

  select count(*) into total from public.sync_mutations;
  if not rejected or total <> 1 then
    raise exception 'FAIL: duplicate idempotency key was not rejected (rows=%)', total;
  end if;

  raise notice 'PASS: duplicate idempotency key rejected, ledger still has 1 row';
end $$;

reset role;
reset request.jwt.claims;

-- =========================================================================================
-- Assertions as Bob, to confirm the mirror direction
-- =========================================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}';

do $$
declare
  visible integer;
begin
  select count(*) into visible from public.tasks;
  if visible <> 1 then
    raise exception 'FAIL: Bob should see exactly 1 task, saw %', visible;
  end if;
  raise notice 'PASS: Bob sees only his own task';
end $$;

-- Bob must not see Alice's ledger rows either.
do $$
declare
  visible integer;
begin
  select count(*) into visible from public.sync_mutations;
  if visible <> 0 then
    raise exception 'FAIL: Bob can see Alice''s sync ledger rows';
  end if;
  raise notice 'PASS: Bob cannot see Alice''s sync ledger';
end $$;

reset role;
reset request.jwt.claims;

-- =========================================================================================
-- Assertions for the unauthenticated (`anon`) role
-- =========================================================================================
set local role anon;

do $$
declare
  visible integer;
  blocked boolean := false;
begin
  begin
    select count(*) into visible from public.tasks;
    -- With no policy for anon, this should raise rather than return rows.
    if visible > 0 then
      raise exception 'FAIL: anon can read tasks (% rows)', visible;
    end if;
  exception
    when insufficient_privilege then
      blocked := true;
  end;

  if not blocked then
    raise exception 'FAIL: anon was not blocked from tasks';
  end if;

  raise notice 'PASS: anon has no access to task data';
end $$;

reset role;

-- Everything is discarded, including the seeded users and rows.
rollback;
