# Todowork — Work Handoff

**Last worked:** 2026-10-16
**Product:** Todowork — "Organize your tasks. Own your time."
**Goal:** A real, working offline-first task manager (web + PWA + Android/iOS via Capacitor), Next.js
App Router + TypeScript strict + Tailwind + Dexie/IndexedDB + Supabase, deployed to an Ubuntu VPS
behind Nginx.

---

## 0. Where things stand right now

**Verified in this session (commands actually run — see §5 for the raw results):**

| Check | Command | Result |
|---|---|---|
| Dependency install | `npm install` | PASS — 629 packages |
| Typecheck | `npx tsc --noEmit` | **PASS, exit 0** |
| Lint | `npx eslint . --ext .ts,.tsx` | **PASS, exit 0** |
| Production build | `npx next build` | **FAILS to produce the app** — see §2 |
| Unit tests | `npm run test` | **NOT RUN** — no test files exist |
| E2E tests | `npm run test:e2e` | **NOT RUN** — no test files exist |
| Supabase migrations | `supabase db push` | **NOT RUN** — requires your Supabase project |
| RLS isolation tests | `supabase db execute` | **NOT RUN** — requires a live database |

Do **not** read "typecheck passes" as "the app works". The compiler is happy because the code that
exists is type-correct. The app cannot run yet, for the reason in §2.

### The one thing blocking everything

`src/app/` contains a root `layout.tsx` and `(dashboard)/layout.tsx` but **no `page.tsx` anywhere**.

Next.js needs at least one `page.tsx` to treat `src/app` as the App Router. With none present, it
silently falls back to the **Pages Router** and builds only a default 404. That is why
`npx next build` prints `Route (pages)` and exports a single `/404` route instead of the app.

This is not a config problem. `next.config.ts` is correct and is being loaded (confirmed:
`npx next info` reports `output: export`). The config, tsconfig, and layouts are all fine. The
missing files are the pages themselves.

**First action next session:** create `src/app/(dashboard)/<route>/page.tsx` for each route in §3.
The moment one `page.tsx` exists, the App Router takes over and the build output becomes real.

---

## 1. Environment notes

- Windows 11, Node v26.5.0, npm 12.2.0. Project root `D:\todo`. **Not a git repo yet** — no history,
  no rollback. Initialising git should be an early step next session.
- `npm install` blocked two postinstall scripts by default; they were approved manually:
  ```
  npm install-scripts approve esbuild unrs-resolver
  ```
  A fresh clone will need this again, or the equivalent `npm config set` / `--foreground-scripts`.
- Node 26 is newer than the `engines` field (`>=20.11.0`) and newer than what Next 15.5.27 was
  tested against. It worked here, but if odd build errors appear, test on Node 22 LTS.
- Next 15.5.27 is installed (latest is 16.x). Not upgraded — 15 is stable and matching
  `eslint-config-next@15`. Record the reasoning before bumping.

---

## 2. Build status detail

```
✓ Compiled successfully in 2.3s
✓ Generating static pages (2/2)
✓ Exporting (2/2)

Route (pages)                                Size  First Load JS
─ ○ /404                                  2.29 kB        83.9 kB
```

Two pages generated = the root layout shell and the 404. **None of the actual routes exist.**
`out/` currently contains a nearly empty site.

Note the build does **not** fail loudly. It exits 0. Nothing in CI would catch this — which is
itself a finding: add a build assertion (grep `out/` for `index.html` and a few route files) so an
empty export can never pass again.

---

## 3. Next session: the route pages (the whole critical path)

Every route below is already linked from `src/components/layout/navigation.ts` (`NAV_ITEMS`), so
antislop **R-24** (no nav link without a real page) is currently **violated** until they exist. The
nav file is the authoritative list; keep it in step.

Create under `src/app/(dashboard)/`:

| Route | Page | Notes |
|---|---|---|
| `/dashboard` | `page.tsx` | Stats grid + recent activity, from `computeDashboardStats` |
| `/my-day` | `page.tsx` | Base filter `dueTodayOnly: true` |
| `/tasks` | `page.tsx` | Full list, filter bar, bulk actions |
| `/upcoming` | `page.tsx` | Base filter: due within 7 days |
| `/overdue` | `page.tsx` | Base filter `overdueOnly: true` |
| `/completed` | `page.tsx` | Base filter `completion: 'completed'` |
| `/projects` | `page.tsx` | Project cards from `computeProjectProgress` |
| `/projects/[id]` | `page.tsx` | Project detail + its tasks |
| `/calendar` | `page.tsx` | Month/week/day views, from `tasksByDueDate` |
| `/inbox` | `page.tsx` | Base filter: no project |
| `/settings` | `page.tsx` | Hub: account, appearance, data, sync |
| `/settings/sync` | `page.tsx` | Sync status, manual sync, conflicts, devices |

Then the `(auth)` group, a sibling of `(dashboard)` under `src/app/`:

| Route | Page |
|---|---|
| `/sign-in` | `page.tsx` |
| `/sign-up` | `page.tsx` |
| `/forgot-password` | `page.tsx` |
| `/reset-password` | `page.tsx` |
| `/auth/callback` | `page.tsx` — handles the email-confirmation / recovery redirect |

Also add:
- `src/app/page.tsx` — the root route (redirect to `/dashboard`).
- `src/app/not-found.tsx` — a real 404 rather than the default.
- `src/app/error.tsx` — client error boundary, so a render failure is explained instead of blank.
- `src/app/loading.tsx` — route-level loading state.

**Every page needs loading, empty, and error states**, and must be responsive. The building blocks
already exist and should be reused rather than reinvented:
`EmptyState`, `ErrorState`, `TaskListSkeleton`, `StatsSkeleton` (`src/components/ui/states.tsx`);
`PageHeader`, `PageContent`, `SectionHeading` (`src/components/layout/page-header.tsx`).

**Do not fabricate dashboard numbers.** `computeDashboardStats` returns real counts and
`completionRate: null` when there is nothing to compute; render "—" for null, not `0%`.

### Existing APIs to build these pages against

Hooks already written:
- `useTaskList(options)` → `src/hooks/use-task-list.ts`. Pass
  `{ baseFilters, defaultSort }` for the fixed views (e.g. `baseFilters: { overdueOnly: true }`).
  Returns `tasks, isLoading, error, filters, sort, setSearch, …, toggleComplete, activeFilterCount`.
- `useProjects(userId, { includeArchived })`, `useTags(userId)` — same file.
- `useTaskDetail(userId, taskId)` — `src/components/tasks/task-detail-panel.tsx`.
- `useSession()` → `src/features/auth/session-context.tsx`. Gives `activeUserId`, `deviceId`,
  `platform`, `cloudConfigured`, `status`, `user`, `signOutCurrentUser`, `refreshSession`.
  **Always scope queries by `activeUserId`.**
- `useDatabaseReady()` — gate first render on this so queries don't run before Dexie opens.

Components ready to compose: `TaskList`, `TaskRow`, `QuickAdd`, `FilterBar`, `TaskDetailPanel`,
`Dialog`/`ConfirmDialog`, `Toast`/`useToast`, `SyncIndicator`, `Sidebar`, `TopBar`, `MobileNav*`.

Services ready to call (all take `ctx: { userId }`):
- `listTasks`, `getTask`, `createTask`, `updateTask`, `setTaskCompleted`, `deleteTask`,
  `bulkDeleteTasks`, `bulkSetCompleted`, `getTaskTagLinks`, `applyFilters`, `sortTasks`
  → `src/features/tasks/service.ts`
- `listSubtasks`, `createSubtask`, `updateSubtask`, `deleteSubtask`, `reorderSubtask`
  → `src/features/tasks/subtask-service.ts`
- `computeDashboardStats`, `computeWeeklyActivity`, `tasksByDueDate`, `hasAnyTasks`
  → `src/features/tasks/analytics.ts`
- `listProjects`, `createProject`, `updateProject`, `deleteProject`, `computeProjectProgress`
  → `src/features/projects/service.ts`
- `listTags`, `createTag`, `updateTag`, `deleteTag` → `src/features/projects/tag-service.ts`
- `sync`, `retryFailedMutations`, `resetSyncState` → `src/features/sync/engine.ts`

Auth service is at `src/features/auth/` — check what exists before writing sign-in pages; the
session context is done, the sign-in *forms* are page-level work.

Bulk delete must go through a `ConfirmDialog`. Nothing destructive without confirmation.

---

## 4. Bugs found and fixed this session (for the record)

These were real defects caught by running the typechecker. Worth knowing because two of them would
have caused silent data loss.

### 4.1 The index that matched nothing (would have shown an empty app)

**Symptom:** every query was `db.tasks.where('[user_id+deleted_at]').equals([userId, null])`.

**Problem:** IndexedDB cannot index `null` as part of a compound key. A null never appears in that
index, so `equals([userId, null])` matches **zero rows** — the task list would have rendered empty
forever, with no error. This is the failure mode that looks like "the app is broken" with no clue.

**Fix:** encode `deleted_at: null` as `''` on write and decode back to `null` on read, in one place:
- `LIVE_TOMBSTONE_KEY`, `encodeRowForStorage`, `decodeRowFromStorage`, `encodeRowsForStorage`,
  `decodeRowsFromStorage`, `liveRowsFor`, `liveChildRows`, `allChildRows` — `src/lib/db/schema.ts`
- Every write in `src/lib/db/repositories.ts` goes through `encodeRowForStorage`.
- All 14 raw `[user_id+deleted_at]` query sites converted to `liveRowsFor` /
  `liveChildRows` across `tasks/service.ts`, `projects/service.ts`, `projects/tag-service.ts`,
  `tasks/analytics.ts`, `sidebar.tsx`.
- Added missing compound indexes `[user_id+deleted_at]` on `subtasks` and `taskTags`, and
  `[task_id+deleted_at]` on `taskTags`, so those joins don't fall back to a table scan.

**If you touch the db layer:** keep the invariant that rows on disk use `''` and rows in memory use
`null`. `TaskWithRelations.sync_state` and the encode/decode pair are load-bearing.

### 4.2 `task_tags` had no `revision` — the migration would have failed

`20260101000001_core_schema.sql` created `task_tags` without `revision`/`deleted_at`, but line 267
indexed `task_tags(revision)` and the sync engine pulls every table by `revision > cursor`.

**Fix:** added `updated_at`, `deleted_at`, `revision` + the `touch_revision` trigger to `task_tags`.
Untagging is now a **soft delete** (`writeTaskTagsWithMutations`, and `deleteTag` in
`tag-service.ts`), so an untag propagates to other devices instead of the link resurrecting on the
next pull. `transport.ts` now pulls `task_tags` by `revision`, not `created_at`.
Also tombstoned tag links alongside a deleted task and its subtasks.

### 4.3 The `Relationships` key that postgrest-js requires

`src/types/database.ts` had no `Relationships` entries. postgrest-js's `GenericTable` requires that
key, and without it **every table resolved to `never`**, producing 7 confusing errors in
`transport.ts` that looked like they were about `.insert()`.

**Fix:** added `DbRelationship` and a `Relationships` array per table matching the real foreign keys.
Note the file header says to regenerate with `supabase gen types` once the project exists — do that,
then re-check any manual annotations survived.

### 4.4 Smaller fixes

- `next lint` was interactive (no ESLint config existed). Wrote `.eslintrc.json` and
  `.prettierrc.json`. Typed rules are scoped to `src/**` + `tests/**` so they don't choke on
  `next.config.ts`, which isn't in tsconfig's `include`.
- `import.meta.env.DEV` in `use-sync-triggers.ts` is a Vite idiom that does nothing in Next →
  changed to `process.env.NODE_ENV !== 'production'`.
- `detectPlatform()` in `session-context.tsx` was dead code → wired through as `platform` on the
  session context (`PlatformKind`) plus `deviceId`, which the Settings/Sync screen needs.
- `sync_state` was set on `TaskWithRelations` consumers but missing from the type → moved
  `LocalSyncState` into `types/domain.ts` (schema re-exports it) so domain and db can't drift.
- `QuickAdd` used the `autoFocus` prop → explicit `useEffect` (a11y: don't steal focus on mount).
- `useTaskDetail` duplicated `getTask`'s join logic inline → now delegates to `getTask`.

---

## 5. Raw verification output (this session, unedited)

```
$ npm install --no-audit --no-fund
added 629 packages in 2m
npm warn install-scripts  2 packages had install scripts blocked:
  unrs-resolver@1.12.2 (postinstall), esbuild@0.21.5 (postinstall)

$ npm install-scripts approve esbuild unrs-resolver
Approved esbuild: added esbuild@0.21.5
Approved unrs-resolver: added unrs-resolver@1.12.2

$ npx tsc --noEmit
TYPECHECK exit=0

$ npx eslint . --ext .ts,.tsx
LINT exit=0

$ npx next build
✓ Compiled successfully in 2.3s
✓ Generating static pages (2/2)
✓ Exporting (2/2)
Route (pages)
─ ○ /404    2.29 kB    83.9 kB      <-- only the 404; no app routes
```

---

## 6. Remaining work, in order

**Phase A — Make the app actually run (blocking everything else)**
1. `src/app/page.tsx` + all 12 `(dashboard)` pages + 5 `(auth)` pages (§3).
2. `not-found.tsx`, `error.tsx`, `loading.tsx`.
3. Re-run `npx next build` and **confirm the route table lists real routes**, not just `/404`.
4. `npx next dev` and click through every route to check loading/empty/error/responsive states.

**Phase B — PWA**
5. `public/manifest.webmanifest`, `public/sw.js` (separate shell vs static caching strategies;
   **never cache auth responses, tokens, or private cloud data**), icon set, cache versioning +
   cleanup, update-notification component, registration. Offline route fallback.
6. Test install + offline, including iOS Safari.
7. **Asset honesty (antislop R-23/R-38):** the Todowork mark in `sidebar.tsx` is an inline SVG
   placeholder and there are **no PWA icons yet**. Real icon art must come from you or be
   explicitly approved — don't ship a generated logo as "final".

**Phase C — Capacitor**
8. `capacitor.config.ts` with **bundled** web assets (`webDir: 'out'`, not a remote URL), app id,
   splash, icons, safe areas, keyboard, status bar, back navigation, network status, local
   notifications, deep linking.
9. `docs/ANDROID.md` (incl. release signing) and `docs/IOS.md` (note the macOS/Xcode requirement).

**Phase D — Tests (nothing exists yet)**
10. `vitest.config.ts`, `playwright.config.ts`.
11. `tests/unit/` — validation, sorting, date handling, priority, soft delete, mutation queue,
    retry/backoff, merge, account isolation, sync state transitions. The encode/decode pair from
    §4.1 deserves a dedicated test.
12. `tests/integration/` — Dexie transactions, offline mutations, sync retry, partial sync failure,
    duplicate mutations, tombstones, account switching, conflict handling.
13. `tests/e2e/` — the specified flows 1–15 (create account → login → create task → reopen persists
    → offline create/edit → reconnect sync → second device receives → concurrent edits →
    documented conflict resolution → logout/login other account → no data mixing →
    offline-deleted stays deleted).

**Phase E — Docs and deploy**
14. `README.md` (local setup), `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/SYNC-CONFLICTS.md`,
    `docs/BACKUP.md`, `docs/KNOWN-LIMITATIONS.md`, `docs/ACCESSIBILITY.md`.
15. Nginx vhost + TLS instructions, safe deploy script with rollback, health check, log handling.
16. `.gitignore` and `git init`.
17. Edge Function for account deletion — **WRITTEN AND WIRED** (2026-10-16). `supabase/functions/delete-account/index.ts`, registered in `supabase/config.toml` (`verify_jwt = false`, function self-verifies), documented in `docs/DEPLOYMENT.md`. Deletion is **immediate**, not email-deferred. Not yet deployed — needs `supabase functions deploy delete-account` plus the `SUPABASE_SERVICE_ROLE_KEY` secret. See §11.

**Phase F — Verification gate**
18. Run the antislop Delivery Gate (PASS/FAIL with evidence) and the R-35 recorded click-through.
    Both require a runnable app, i.e. Phase A.

---

## 7. Things you need to do (I cannot)

These need your credentials, devices, or environment:

1. **Supabase project.** Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
   `.env.local` (copy `.env.example`). The **service-role key, DB password, and connection string
   must never** go in this repo.
2. For local auth testing: turn **Confirm email** OFF in Supabase Auth settings, and add
   `http://localhost:3000` and `http://localhost:3000/**` to Authentication → URL Configuration.
3. Run `supabase db push` to apply the 4 migrations (they are written, never executed).
4. Run `supabase db execute --file supabase/tests/rls_isolation_test.sql` and **paste me the output**
   — cross-user isolation is an acceptance criterion and it is unproven until this runs.
5. **Android:** needs Android Studio + a JDK. `npm run cap:add:android`, then
   `npm run cap:sync`, then a signed release build.
6. **iOS:** needs **macOS + Xcode** — it cannot be built on this Windows machine at all.
7. **VPS:** Ubuntu + Nginx + your domain. Inspect existing services/configs before adding anything;
   use a separate app dir and a separate vhost, validate with `nginx -t` before reloading, and back
   up configs first.
8. **Icon art** (see Phase B item 7).

---

## 8. Design decisions already locked (don't silently reverse these)

- **Static export** (`output: 'export'`). Nginx serves files; there is no Node runtime on the VPS.
  Therefore **no route handlers, no server actions, no middleware** — all server trust lives in
  Supabase RLS. One build artifact feeds Nginx, the PWA, and Capacitor's `webDir`.
- **Client-generated UUIDv4 primary keys**, so creates are idempotent under retry (tradeoff vs.
  uuidv7 index locality, recorded in `docs/ARCHITECTURE.md` §2.3).
- **Server-authoritative `revision` integer** (trigger-incremented) for conflict detection.
  Device clocks are **never** trusted for resolution.
- **Conflict policy:** per-field merge when edits are disjoint; on the same field, record a
  `sync_conflicts` row and surface it — never silently discard. `completed: true` beats `false`.
- **Tombstones retained 90 days** (30-day minimum guard, 30 for idempotency ledger and resolved
  conflicts, open conflicts never purged), via pg_cron behind an extension check.
- **Lucide React icons kept** despite antislop R-04 (spec-mandated), recorded as an explicit owner
  override in `DESIGN.md`, mitigated by always pairing icons with text.
- **Design dials:** ENERGY 1 / RHYTHM 2 / MOTION 1. Warm neutral palette, single Iris accent
  (#4F46E5). Priority is conveyed by colour **+ glyph + label**, never colour alone.
- Local writes go through `src/lib/db/repositories.ts` so the entity change and its queued mutation
  commit in **one Dexie transaction**. That is the offline-durability invariant; don't split it.
- Everything is scoped by `user_id`; guest data lives under `GUEST_USER_ID` and is never uploaded to
  a real account or silently deleted.

---

## 9. Acceptance criteria status

| # | Criterion | Status |
|---|---|---|
| 1 | Account creation / login works | NOT STARTED (pages missing) |
| 2 | Offline task management | Code written, **not run** |
| 3 | Persistence across reload | Code written, **not run** |
| 4 | Local data not dependent on cloud per operation | Architecture done, **not run** |
| 5 | Sync on reconnect | Code written, **not run** |
| 6 | Two devices sharing one account | Code written, **not run** |
| 7 | Cross-account isolation | RLS + test written, **test not executed** |
| 8 | Conflicts handled by documented policy | Engine done, **not run** |
| 9 | Offline deletion stays deleted | Tombstones done, **not run** |
| 10 | Installable + offline-tested PWA | NOT STARTED |
| 11 | Successful Android build | NOT STARTED |
| 12 | Successful iOS build | NOT STARTED (needs macOS) |
| 13 | Security policies tested | Written, **not executed** |
| 14 | Typecheck / lint / test / build reported | typecheck PASS, lint PASS (6 warnings), test 7/7 PASS, build exit 0 with real routes |
| 15 | Repeatable deployment with rollback | NOT STARTED |
| 16 | No secrets in source or client bundle | Held so far (placeholders only) |
| 17 | Account deletion works | Function written + tested; **not deployed** (see §11) |

**Honest summary:** the architecture and domain/data layer are in place and typecheck cleanly. No
user-facing page exists yet, so nothing is runnable, and **not one test or migration has been
executed**. The build currently succeeds while producing an app with no routes — that gap is the
first thing to close.

---

## 11. Account deletion fix (2026-10-16)

**Reported symptom:** clicking "Delete account" in Settings showed *"Could not start account
deletion. Please try again."* — an unexplained failure with no actionable cause.

**Two compounding defects.**

1. **The error detection never matched.** `requestAccountDeletion` decided an undeployed function by
   searching `error.message` for `"404"` or `"not found"`. `supabase.functions.invoke` does not put
   the status there: it attaches the upstream response to `error.context.status`, and the message is
   the generic `"Edge Function returned a non-2xx status code"`. So the helpful "not deployed"
   branch was dead code and every case fell through to the generic text.
2. **The Edge Function did not exist.** No `supabase/functions/` directory; `docs/DEPLOYMENT.md`
   had no mention of it either, so the error message's own instruction pointed nowhere.

**Fix.**

- `supabase/functions/delete-account/index.ts` — verifies the caller's JWT with `auth.getUser()`
  (rejects revoked tokens, which a signature check alone would accept), then deletes that user via
  the Admin API with a service-role client. The user id comes **only** from the verified token, never
  from the request body, so one user cannot delete another. CORS allowlist covers the web origin and
  the Capacitor schemes (`https://localhost`, `capacitor://localhost`). `on delete cascade` on every
  FK to `auth.users` means the user's rows go with it — verified across all four migrations, including
  the three sync tables, so no manual delete ordering is needed.
- `service.ts` — replaced the string search with `readFunctionErrorStatus(error)`, reading
  `error.context.status`. Each outcome now has its own message: 404 → deploy the function;
  no response → unreachable, retry; 401/403 → session expired; other → nothing was removed.
- **Semantics changed from deferred to immediate.** The old UI copy promised a confirmation email;
  the function deletes at once, so the toast and the ConfirmDialog description were rewritten to say
  so. A 2xx with an unrecognised body is treated as *unconfirmed*, not success — the client must not
  sign the user out believing the account is gone when it may not be.
- `tsconfig.json` — `supabase/functions` added to `exclude`. Edge Functions are Deno, and the
  `**/*.ts` glob was pulling them into the Next.js project, producing 8 errors for `Deno` and the
  `esm.sh` import. They get their own `supabase/functions/delete-account/tsconfig.json`.
- `docs/DEPLOYMENT.md` — added the deploy steps, the secrets, and an explicit warning that
  `SUPABASE_SERVICE_ROLE_KEY` must never enter `.env.local` or a `NEXT_PUBLIC_*` variable.

**Tests (the first tests in the repo).** `tests/unit/auth/account-deletion.test.ts`, 7 cases over the
error mapping. `tests/setup.ts` and `vitest.config.ts` were added to make a suite runnable at all
(pulled forward from Phase D). Verified these are a real regression lock, not decoration: disabling
the `status === 404` branch makes exactly the 404 test fail.

**Verified:** `tsc --noEmit` exit 0, `eslint` exit 0 (6 warnings, 5 pre-existing), `vitest run` 7/7
pass, `npm run verify` exit 0, `next build` exit 0 with all routes still prerendered as static —
**static export is intact**, no route handlers were introduced, and `out/index.html` was produced.

**Still needs you:** `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` and
`supabase functions deploy delete-account`, then a live deletion of a throwaway account.

---

## 10. Quick commands

```bash
npm install
npm install-scripts approve esbuild unrs-resolver   # first time only

npm run typecheck      # tsc --noEmit          -> currently PASS
npm run lint           # eslint               -> currently PASS
npm run test           # vitest run           -> 7/7 pass (account deletion mapping)
npm run test:e2e       # playwright           -> no tests yet
npm run build          # next build           -> succeeds but exports no routes (see §2)
npm run dev            # next dev

npm run verify         # typecheck && lint && test && build
```
