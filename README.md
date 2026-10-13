# Todowork

> Organize your tasks. Own your time.

An offline-first task manager that works on web, PWA, Android, and iOS. Your tasks live on your device first — sync is optional. Built for people who open their task app twenty times a day and need it fast, quiet, and dependable.

## Why Todowork

**It works without the internet.** Tasks are stored in your browser's IndexedDB. You can create, complete, and organize tasks on a plane, in a tunnel, or on flaky mobile data. When you're online and signed in, changes sync silently across your devices.

**It doesn't ask you to sign up before you can try it.** Open the app and start working. Sign in only when you want to sync. Your guest data stays on your device until you do.

**It's fast because it's boring.** No gradients, no animated entrances, no dashboard theatrics. One accent color, one checkmark, one work rail that tells you which project a task belongs to. The UI gets out of the way so the work doesn't.

## Features

- **My Day** — what's due today, nothing else
- **Tasks** — the full list with filters, search, bulk complete, and bulk delete
- **Upcoming** — the next seven days at a glance
- **Overdue** — what you missed, front and center
- **Completed** — what you finished, newest first
- **Inbox** — tasks with no project yet, a staging area for unfiled work
- **Projects** — group tasks under a colored label with a live progress bar
- **Calendar** — month, week, and day views over your due dates
- **Settings** — theme (light/dark/system), local data controls, sync status, conflict review
- **Sync** — incremental pull/push with revision-based conflict detection
- **Guest mode** — full functionality without an account

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router, static export) | SPA behavior, no server needed, deploys anywhere |
| Language | TypeScript (strict, noUncheckedIndexedAccess) | Catch errors at compile time, not at 2 AM |
| Styling | Tailwind CSS with design tokens | One source of color truth, theming via CSS variables |
| Local DB | Dexie (IndexedDB wrapper) | Offline-first storage that survives app closes |
| Cloud DB | Supabase (Postgres + Auth + RLS) | Managed Postgres with row-level security per user |
| Sync | Custom revision-based engine | Server-owned revisions, idempotent mutations, soft deletes |
| Mobile | Capacitor (planned) | Wrap the same web app for Android and iOS |

## Getting Started

### Prerequisites

- Node.js 20.11+ (tested on Node 26)
- npm 10+

### Install

```bash
git clone https://github.com/reipand/todowork.git
cd todowork
npm install
```

If the install blocks postinstall scripts:

```bash
npm install-scripts approve esbuild unrs-resolver
```

### Configure Supabase (optional — required for sync)

1. Create a project at [supabase.com](https://supabase.com)
2. Run the SQL migrations (Dashboard → SQL Editor):
   ```sql
   -- Paste the contents of supabase/setup_all.sql
   ```
3. Create `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

Without these, the app runs in **guest mode** — fully functional, local-only, no sync.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll see the sign-in page. Create an account or click "Continue as guest."

### Build

```bash
npm run build
```

Outputs a static site to `out/`. Deploy behind any static host or Nginx.

## Project Structure

```
src/
├── app/
│   ├── (auth)/              # Sign in, sign up, forgot/reset password, callback
│   ├── (dashboard)/         # All authenticated routes
│   │   ├── dashboard/       # Stats + activity feed
│   │   ├── my-day/          # Due today
│   │   ├── tasks/           # Full task list
│   │   ├── upcoming/        # Next 7 days
│   │   ├── overdue/         # Past due
│   │   ├── completed/       # Finished tasks
│   │   ├── inbox/           # No-project tasks
│   │   ├── projects/        # Project cards + detail
│   │   ├── calendar/        # Month/week/day views
│   │   └── settings/        # Account, theme, data, sync
│   ├── layout.tsx           # Root layout (fonts, providers, theme init)
│   ├── page.tsx             # Auth gate → /dashboard or /sign-in
│   ├── error.tsx            # Error boundary
│   ├── loading.tsx          # Route-level skeleton
│   └── not-found.tsx        # 404
├── components/
│   ├── layout/              # Shell, sidebar, top bar, nav, page header
│   ├── tasks/               # Task list, quick add, filter bar, detail panel
│   └── ui/                  # Button, dialog, field, toast, states, sync indicator
├── features/
│   ├── auth/                # Session context, auth service
│   ├── projects/            # Project service
│   ├── settings/            # Theme context
│   ├── sync/                # Sync engine, transport
│   └── tasks/               # Task service, analytics
├── hooks/                   # useTaskList, useProjects, useTags, useSyncTriggers
├── lib/
│   ├── db/                  # Dexie schema, repositories, helpers
│   ├── supabase/            # Supabase client (single instance)
│   ├── utils/               # Date helpers, cn
│   └── validation/          # Zod schemas
├── styles/                  # Design tokens (CSS variables)
└── types/                   # Domain types, database types
```

## Database Schema

Six core tables + three sync tables, all protected by RLS:

| Table | Purpose |
|-------|---------|
| `profiles` | User display name, auto-created on signup |
| `projects` | Task groups with color and archive state |
| `tasks` | The work itself — title, priority, due date, completion |
| `tags` | Cross-cutting labels |
| `task_tags` | Join table (many-to-many) |
| `task_subtasks` | Nested checklists |
| `sync_mutations` | Idempotency ledger for safe retries |
| `sync_conflicts` | Unmergeable concurrent edits (both variants kept) |
| `sync_devices` | Per-device pull cursor for incremental sync |

Every table carries `revision` (server-owned, trigger-incremented) and `deleted_at` (soft delete tombstone). RLS ensures a user sees only their own rows. `anon` gets nothing.

## Scripts

```bash
npm run dev          # Start dev server
npm run build        # Static export to out/
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run format       # Prettier write
npm run test         # Vitest (no tests yet)
```

## Deployment

### Static host (Nginx)

```nginx
server {
    listen 80;
    root /var/www/todowork;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # SPA fallback for dynamic project routes
    location /projects/ {
        try_files $uri $uri/ /projects/_/index.html;
    }
}
```

### Mobile (Capacitor, planned)

```bash
npx cap init Todowork com.todowork.app
npx cap add android
npx cap add ios
npx cap copy
```

## License

Private project. All rights reserved.

---

Built with restraint. One accent color, one checkmark, one promise: your tasks are always there.
