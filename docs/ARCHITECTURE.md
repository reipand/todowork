# Todowork — Architecture

## 1. Shape of the system

```
┌──────────────────────────────────────────────────────────────┐
│  UI  (Next.js App Router, static export; Capacitor shell)    │
│  reads from IndexedDB, never blocks on the network            │
└──────────────────────────┬───────────────────────────────────┘
                           │ hooks + reactive queries
┌──────────────────────────▼───────────────────────────────────┐
│  Application services  (src/features/*/service.ts)            │
│  validation · orchestration · writes local + enqueues         │
└──────────────────────────┬───────────────────────────────────┘
                           │ single transaction
┌──────────────────────────▼───────────────────────────────────┐
│  Dexie / IndexedDB      ── source of truth for the UI ──      │
│  tasks · projects · tags · subtasks · mutations · meta        │
└──────────────────────────┬───────────────────────────────────┘
                           │ durable queue, drained when online
┌──────────────────────────▼───────────────────────────────────┐
│  Sync engine            (src/features/sync/)                  │
│  push mutations · pull revisions · conflicts · backoff        │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS, JWT from Auth session
┌──────────────────────────▼───────────────────────────────────┐
│  Supabase Auth  →  Supabase Postgres (RLS enforced)           │
└──────────────────────────────────────────────────────────────┘
```

## 2. Decisions and why

### 2.1 Static export, not a Next.js server

`next.config.ts` sets `output: 'export'`. The build emits a directory of static files.

- Nginx serves them directly; the VPS needs no Node process, no PM2, no port reservation.
- Capacitor consumes the same output as `webDir`, so web/PWA/Android/iOS ship from one build.
- An offline-first app cannot depend on a server round-trip to render, so server rendering
  buys nothing here.

**What this forbids, and the replacement:** no route handlers, no server actions, no
middleware. Anything requiring server trust lives in Postgres and is enforced by RLS. This
is not a workaround; it is the correct boundary for a multi-device client, because a
malicious client can talk to Postgres directly with the same anon key. Trust must be in the
database, not in a server the attacker can bypass.

### 2.2 IndexedDB is the UI's source of truth

Every read in the app comes from Dexie. No component awaits Supabase to render. This is what
makes offline a property of the system rather than a feature bolted on. Consequence: a
component must render correctly from local state alone, including when the row is a local
draft that has never reached the server.

### 2.3 Client-generated UUIDv4 primary keys

The browser mints the row id before the row exists anywhere else. That makes create
operations idempotent under retry: the same mutation replayed hits `on conflict (id) do
update`, producing one row, not two.

Note on the Postgres best-practices advice: `uuidv7`/time-ordered ids are preferred for
index locality on large tables. We accept the tradeoff because client-generated ids are
non-negotiable for offline-first, and per-user task counts are small (thousands, not
millions). If a table ever grows large, revisit. Recorded here so the deviation is
deliberate, not accidental.

### 2.4 Server-authoritative `revision`, not timestamps

Every syncable row carries `integer revision`. The server increments it on each accepted
write via trigger. Clients compare revisions to detect concurrent edits.

**Why not timestamps:** device clocks are wrong, skewed, and user-settable. A phone set two
minutes fast would silently win every conflict. Revisions are monotonic and server-owned, so
"newer" has a single unambiguous definition.

### 2.5 Conflict policy: optimistic concurrency + field merge, never silent loss

When a client pushes a mutation carrying `base_revision` and the server's current revision
is higher, the edit is concurrent. The policy, documented in `docs/SYNC-CONFLICTS.md`:

1. **Per-field merge** if the two edit sets touch disjoint mutable fields (e.g. one device
   edited `title`, the other `due_date`). Both survive. This is the common case.
2. **Conflict record** if both edited the same field to different values. The server keeps
   the row, writes a `sync_conflicts` row holding both variants, and returns HTTP 409. The
   client surfaces a resolution UI. **No write is silently discarded.**
3. `completed` is special-cased: `true` wins over `false` when the other side merely
   changed an unrelated field, because re-completing is idempotent and un-completing by
   accident is the more annoying failure. A genuine complete-vs-reopen conflict still
   produces a conflict record.

### 2.6 Tombstones are soft deletes, retained for 90 days

`deleted_at` is set, never `DELETE`. A device that has been offline for weeks must still
learn that a row was deleted; hard-deleting would make it re-upload the row and resurrect it.
That resurrection bug is the single most common failure in naive offline sync, so the schema
is built to prevent it. See §21 of the spec.

Retention: tombstones older than 90 days are purged by `pg_cron`. 90 days is chosen as a
conservative margin beyond any plausible offline window.

### 2.7 Idempotency keys make retry safe

Every mutation carries a client-generated `idempotency_key`, stored in
`sync_mutations.idempotency_key` with a unique constraint. A retried mutation that already
succeeded hits the unique constraint and returns the original result instead of applying
twice. This is what makes aggressive retry safe, which in turn is what makes the queue
correct on flaky mobile networks.

### 2.8 Account switching isolates by `user_id` on every local query

Dexie tables are keyed and indexed by `user_id`. Every local read is scoped by the active
user id. Switching accounts clears the in-memory sync cursor, cancels in-flight sync, and
re-scopes queries. Guest data is quarantined under a reserved id and requires explicit user
confirmation before it is claimed by a cloud account. No local data is ever deleted
implicitly. Details in `docs/SECURITY.md`.

## 3. Trust boundaries

| Boundary | Enforcement |
|---|---|
| Browser/device → Postgres | RLS on every table, `(select auth.uid()) = user_id` in USING and WITH CHECK |
| Client input → database | Zod validation at the service layer, plus CHECK constraints and length limits in SQL |
| Mobile bundle | Only the anon key. `service_role` never ships to any client. |
| Auth tokens | Held by the Supabase SDK in its own storage; never written into a mutation payload or a log |

Input is validated on the client for user experience and in the database for enforcement.
The client check is a convenience; the database check is the security control.
