'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Documentation & tutorial page.
 *
 * Standalone route outside the (auth) and (dashboard) groups so it's accessible
 * without a session. Renders at build time as a static page.
 */

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'features', label: 'Features' },
  { id: 'database', label: 'Database Setup' },
  { id: 'environment', label: 'Environment' },
  { id: 'install', label: 'Install & Run' },
  { id: 'tutorial', label: 'Tutorial' },
  { id: 'sync', label: 'How Sync Works' },
  { id: 'pwa', label: 'PWA & Mobile' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'architecture', label: 'Architecture' },
] as const;

export default function DocsPage() {
  const [activeId, setActiveId] = useState<string>('overview');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );

    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMenuOpen(false);
    }
  };

  return (
    <div className="min-h-dvh bg-paper">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-title font-semibold text-ink">
            <span className="text-accent">Todowork</span>
            <span className="text-ink-muted">/ Docs</span>
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-control border border-line px-3 py-1.5 text-body text-ink-secondary hover:bg-sunken lg:hidden"
              aria-expanded={menuOpen}
              aria-label="Toggle navigation"
            >
              Sections
            </button>
            <Link
              href="/"
              className="rounded-control bg-accent px-3 py-1.5 text-body font-medium text-accent-fg hover:bg-accent-hover"
            >
              Open App
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-4 sm:px-6">
        {/* Sidebar nav */}
        <nav
          className={`${
            menuOpen ? 'block' : 'hidden'
          } fixed inset-x-0 top-[57px] z-20 border-b border-line bg-surface px-4 py-4 lg:sticky lg:top-[57px] lg:block lg:h-[calc(100dvh-57px)] lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-0 lg:py-6`}
        >
          <ul className="space-y-1 lg:pl-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  className={`w-full rounded-control px-3 py-1.5 text-left text-body transition-colors hover-hover ${
                    activeId === s.id
                      ? 'bg-accent-soft text-accent font-medium'
                      : 'text-ink-secondary hover:bg-sunken'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Main content */}
        <main id="main-content" className="min-w-0 flex-1 py-8 lg:py-10">
          {/* OVERVIEW */}
          <section id="overview" className="scroll-mt-20">
            <h1 className="text-display text-ink">Todowork Documentation</h1>
            <p className="mt-3 max-w-2xl text-body text-ink-secondary">
              Offline-first task manager for web, PWA, Android, and iOS. Tasks live on your device
              first — sync is optional. Built for people who open their task app twenty times a day.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-meta font-medium text-ink-muted">Stack</div>
                <div className="mt-1 text-body text-ink">Next.js · TypeScript · Dexie · Supabase</div>
              </div>
              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-meta font-medium text-ink-muted">Platforms</div>
                <div className="mt-1 text-body text-ink">Web · PWA · Android · iOS</div>
              </div>
              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-meta font-medium text-ink-muted">Mode</div>
                <div className="mt-1 text-body text-ink">Static export, no server runtime</div>
              </div>
            </div>

            <p className="mt-6 max-w-2xl text-body text-ink-secondary">
              The app stores tasks in <strong className="text-ink">IndexedDB</strong> via Dexie.
              When you sign in, changes sync to <strong className="text-ink">Supabase Postgres</strong>{' '}
              with row-level security. Guest mode works fully offline with no account.
            </p>
          </section>

          <hr className="my-10 border-line" />

          {/* FEATURES */}
          <section id="features" className="scroll-mt-20">
            <h2 className="text-title text-ink">Features</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ['My Day', 'What is due today, nothing else.'],
                ['Tasks', 'Full list with filters, search, bulk complete, and bulk delete.'],
                ['Upcoming', 'Next seven days at a glance.'],
                ['Overdue', 'What you missed, front and center.'],
                ['Completed', 'Finished tasks, newest first.'],
                ['Inbox', 'Tasks with no project yet — a staging area.'],
                ['Projects', 'Group tasks under a colored label with live progress bar.'],
                ['Calendar', 'Month, week, and day views over your due dates.'],
                ['Settings', 'Theme (light/dark/system), local data controls, sync status.'],
                ['Sync', 'Incremental pull/push with revision-based conflict detection.'],
                ['Guest mode', 'Full functionality without an account.'],
                ['PWA', 'Installable, offline-capable, auto-updating service worker.'],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-card border border-line bg-surface p-4">
                  <div className="text-body font-medium text-ink">{title}</div>
                  <div className="mt-0.5 text-body text-ink-secondary">{desc}</div>
                </div>
              ))}
            </div>
          </section>

          <hr className="my-10 border-line" />

          {/* DATABASE */}
          <section id="database" className="scroll-mt-20">
            <h2 className="text-title text-ink">Database Setup</h2>
            <p className="mt-2 text-body text-ink-secondary">
              Required for sync and multi-device. Without this, the app runs in guest mode (local
              only, no sync).
            </p>

            <h3 className="mt-6 text-body font-semibold text-ink">1. Create a Supabase project</h3>
            <p className="mt-1 text-body text-ink-secondary">
              Go to{' '}
              <a
                href="https://supabase.com"
                className="text-accent underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                supabase.com
              </a>{' '}
              and create a new project. Note the project URL and anon key from{' '}
              <strong className="text-ink">Settings → API</strong>.
            </p>

            <h3 className="mt-6 text-body font-semibold text-ink">2. Run the SQL migration</h3>
            <p className="mt-1 text-body text-ink-secondary">
              In Supabase Dashboard, open <strong className="text-ink">SQL Editor</strong> and paste
              the entire contents of <code className="font-mono text-mono text-accent">supabase/setup_all.sql</code>{' '}
              from this repo. Click <strong className="text-ink">Run</strong>. The script is
              idempotent — safe to re-run.
            </p>

            <CodeBlock
              label="What the migration creates"
              lines={[
                'profiles         — auto-created on signup, display name',
                'projects         — task groups with color + archive state',
                'tasks            — title, priority, due date, completion',
                'tags             — cross-cutting labels',
                'task_tags        — join table (many-to-many)',
                'task_subtasks    — nested checklists',
                'sync_mutations   — idempotency ledger for safe retries',
                'sync_conflicts   — unmergeable concurrent edits (both kept)',
                'sync_devices     — per-device pull cursor for incremental sync',
                '',
                'RLS: every table enforces (select auth.uid()) = user_id',
                'Triggers: revision auto-incremented on every accepted write',
              ]}
            />

            <h3 className="mt-6 text-body font-semibold text-ink">3. Configure auth settings</h3>
            <p className="mt-1 text-body text-ink-secondary">
              In Supabase Dashboard → <strong className="text-ink">Authentication → Sign In / Providers</strong>:
            </p>
            <ul className="mt-2 space-y-2 text-body text-ink-secondary">
              <li className="flex gap-2">
                <span className="text-accent">▸</span>
                <span>
                  <strong className="text-ink">Confirm email</strong> — toggle OFF for development
                  (instant signup, no email needed). Toggle ON for production (requires SMTP).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-accent">▸</span>
                <span>
                  <strong className="text-ink">URL Configuration</strong> → add your redirect URLs:{' '}
                  <code className="font-mono text-mono text-accent">http://localhost:3000/auth/callback</code>{' '}
                  and{' '}
                  <code className="font-mono text-mono text-accent">
                    https://yourdomain.com/auth/callback
                  </code>
                </span>
              </li>
            </ul>

            <div className="mt-4 rounded-card border border-warning/30 bg-warning-soft p-4">
              <div className="text-body font-medium text-warning">SMTP note</div>
              <p className="mt-1 text-body text-ink-secondary">
                If you enable email confirmations in production, configure a custom SMTP provider
                (Brevo, Resend, etc.) under <strong className="text-ink">Authentication → SMTP
                Settings</strong>. Supabase&apos;s built-in email is rate-limited and not for
                production.
              </p>
            </div>
          </section>

          <hr className="my-10 border-line" />

          {/* ENVIRONMENT */}
          <section id="environment" className="scroll-mt-20">
            <h2 className="text-title text-ink">Environment</h2>
            <p className="mt-2 text-body text-ink-secondary">
              Create <code className="font-mono text-mono text-accent">.env.local</code> in the
              project root:
            </p>
            <CodeBlock
              label=".env.local"
              lines={[
                'NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co',
                'NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key',
                'NEXT_PUBLIC_APP_URL=http://localhost:3000',
              ]}
            />
            <p className="mt-3 text-body text-ink-secondary">
              For production builds, set <code className="font-mono text-mono text-accent">NEXT_PUBLIC_APP_URL</code>{' '}
              to your production domain. The anon key is safe to ship in client bundles — RLS
              enforces all security. Never put the <strong className="text-ink">service-role key</strong>{' '}
              in the client.
            </p>
            <p className="mt-3 text-body text-ink-secondary">
              Without these variables, the app runs in <strong className="text-ink">guest mode</strong>{' '}
              — fully functional, local-only, no sync.
            </p>
          </section>

          <hr className="my-10 border-line" />

          {/* INSTALL */}
          <section id="install" className="scroll-mt-20">
            <h2 className="text-title text-ink">Install & Run</h2>
            <h3 className="mt-4 text-body font-semibold text-ink">Prerequisites</h3>
            <ul className="mt-2 space-y-1 text-body text-ink-secondary">
              <li className="flex gap-2"><span className="text-accent">▸</span>Node.js 20.11+</li>
              <li className="flex gap-2"><span className="text-accent">▸</span>npm 10+</li>
            </ul>

            <CodeBlock
              label="Setup"
              lines={[
                'git clone https://github.com/reipand/todowork.git',
                'cd todowork',
                'npm install',
                '',
                '# If postinstall scripts are blocked:',
                'npm install-scripts approve esbuild unrs-resolver',
              ]}
            />

            <CodeBlock
              label="Development"
              lines={[
                'npm run dev    # http://localhost:3000',
              ]}
            />

            <CodeBlock
              label="Production build (static export to out/)"
              lines={[
                'npm run build  # outputs to out/',
              ]}
            />

            <CodeBlock
              label="Other scripts"
              lines={[
                'npm run lint       # ESLint',
                'npm run typecheck  # tsc --noEmit',
                'npm run format     # Prettier write',
              ]}
            />
          </section>

          <hr className="my-10 border-line" />

          {/* TUTORIAL */}
          <section id="tutorial" className="scroll-mt-20">
            <h2 className="text-title text-ink">Tutorial</h2>
            <p className="mt-2 text-body text-ink-secondary">
              A quick walkthrough of using Todowork from zero to synced.
            </p>

            <div className="mt-6 space-y-6">
              <Step
                num={1}
                title="Open the app"
                body="Open the app at your deployed URL or localhost:3000. You'll see the sign-in page. You can sign up for an account or click Continue as guest to start immediately without one."
              />
              <Step
                num={2}
                title="Create an account"
                body="Enter email and password on the sign-up page. If email confirmations are off, you're signed in immediately. If on, check your inbox for a confirmation link before signing in."
              />
              <Step
                num={3}
                title="Create your first task"
                body="Use the Quick Add bar at the top of any list view. Type a title and press Enter. The task appears in the list instantly — it writes to IndexedDB first, no network wait."
              />
              <Step
                num={4}
                title="Set priority, due date, and project"
                body="Click a task to open the detail panel on the right. Set priority (High ▲, Medium ■, Low ●), due date, assign to a project, add tags, or create subtasks. Every change is saved locally immediately."
              />
              <Step
                num={5}
                title="Organize with projects"
                body="Go to Projects to create colored project labels like Work, Personal, Side Project. Each project shows a live progress bar. Assign tasks to projects from the detail panel or the task list."
              />
              <Step
                num={6}
                title="Use My Day and views"
                body="My Day shows only what's due today. Upcoming shows the next 7 days. Overdue surfaces what you missed. Inbox collects tasks without a project. Completed archives finished work. Calendar gives month/week/day views."
              />
              <Step
                num={7}
                title="Sync across devices"
                body="Sign in on another device with the same account. Your tasks sync automatically — pull brings server changes to the device, push sends local mutations up. Sync runs on app open, on focus, every 30 seconds, and on realtime websocket events."
              />
              <Step
                num={8}
                title="Work offline"
                body="Turn off your internet. Create, edit, complete, and delete tasks — everything works. Changes queue in IndexedDB. When you reconnect, the sync engine pushes queued mutations and pulls remote changes automatically."
              />
              <Step
                num={9}
                title="Install as PWA"
                body="In Chrome or Safari, use the browser menu to Add to Home Screen / Install. The app runs as a standalone app with its own window, works offline, and auto-updates via the service worker."
              />
            </div>
          </section>

          <hr className="my-10 border-line" />

          {/* SYNC */}
          <section id="sync" className="scroll-mt-20">
            <h2 className="text-title text-ink">How Sync Works</h2>
            <p className="mt-2 text-body text-ink-secondary">
              Sync is revision-based, idempotent, and never silently discards data.
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-body font-medium text-ink">Local writes</div>
                <p className="mt-1 text-body text-ink-secondary">
                  Every write (create, update, delete, toggle) goes to Dexie/IndexedDB and enqueues
                  a mutation in the same transaction. The UI updates instantly from local state.
                </p>
              </div>

              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-body font-medium text-ink">Push</div>
                <p className="mt-1 text-body text-ink-secondary">
                  Each mutation carries an <code className="font-mono text-mono text-accent">idempotency_key</code>.
                  If a push fails mid-flight and retries, the server returns the original result
                  instead of applying twice. A transient failure is never falsely treated as a
                  duplicate — only a confirmed <code className="font-mono text-mono text-accent">result_revision</code>{' '}
                  marks a mutation as done.
                </p>
              </div>

              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-body font-medium text-ink">Pull</div>
                <p className="mt-1 text-body text-ink-secondary">
                  Each device tracks its pull cursor (last revision seen). Pull requests{' '}
                  <code className="font-mono text-mono text-accent">?revision=gt.cursor</code> for
                  each table. Only rows the device has not seen are returned — incremental, not
                  full-table.
                </p>
              </div>

              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-body font-medium text-ink">Conflicts</div>
                <p className="mt-1 text-body text-ink-secondary">
                  When a push carries <code className="font-mono text-mono text-accent">base_revision</code>{' '}
                  and the server revision is higher, the edit is concurrent. Disjoint field edits
                  merge automatically. Same-field conflicts create a{' '}
                  <code className="font-mono text-mono text-accent">sync_conflicts</code> row (both
                  variants kept) and surface in Settings → Sync.{' '}
                  <code className="font-mono text-mono text-accent">completed: true</code> always
                  wins over <code className="font-mono text-mono text-accent">false</code>.
                </p>
              </div>

              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-body font-medium text-ink">Soft deletes</div>
                <p className="mt-1 text-body text-ink-secondary">
                  Deleting a task sets <code className="font-mono text-mono text-accent">deleted_at</code>,
                  never <code className="font-mono text-mono text-accent">DELETE</code>. A device
                  offline for weeks learns about the deletion on next pull. Tombstones are purged
                  after 90 days via pg_cron.
                </p>
              </div>

              <div className="rounded-card border border-line bg-surface p-4">
                <div className="text-body font-medium text-ink">Sync triggers</div>
                <ul className="mt-2 space-y-1 text-body text-ink-secondary">
                  <li>App mount / page focus</li>
                  <li>Browser online event</li>
                  <li>Visibility change (tab switch)</li>
                  <li>Interval: every 30 seconds</li>
                  <li>Realtime: Supabase Postgres Changes (websocket)</li>
                </ul>
              </div>
            </div>
          </section>

          <hr className="my-10 border-line" />

          {/* PWA & MOBILE */}
          <section id="pwa" className="scroll-mt-20">
            <h2 className="text-title text-ink">PWA & Mobile</h2>

            <h3 className="mt-4 text-body font-semibold text-ink">PWA</h3>
            <p className="mt-1 text-body text-ink-secondary">
              The service worker (<code className="font-mono text-mono text-accent">public/sw.js</code>)
              caches the app shell for offline use. Navigation requests are network-first; static
              assets use stale-while-revalidate. New deploys auto-update via{' '}
              <code className="font-mono text-mono text-accent">skipWaiting()</code>. Supabase
              requests are never cached.
            </p>
            <p className="mt-2 text-body text-ink-secondary">
              To install: browser menu → Add to Home Screen / Install app. Works on Chrome, Edge,
              Safari, and Firefox.
            </p>

            <h3 className="mt-6 text-body font-semibold text-ink">Android & iOS (Capacitor)</h3>
            <p className="mt-1 text-body text-ink-secondary">
              The same <code className="font-mono text-mono text-accent">out/</code> build is
              bundled into native apps via Capacitor.
            </p>
            <CodeBlock
              label="Build mobile"
              lines={[
                'npm run build     # generate out/',
                'npx cap sync     # copy to native projects',
                '',
                '# Android',
                'npx cap open android   # opens Android Studio',
                '',
                '# iOS (requires macOS + Xcode)',
                'npx cap open ios       # opens Xcode',
              ]}
            />
            <p className="mt-3 text-body text-ink-secondary">
              See <code className="font-mono text-mono text-accent">docs/DEPLOYMENT.md</code> for
              full deployment guide including APK/AAB and IPA builds.
            </p>
          </section>

          <hr className="my-10 border-line" />

          {/* TROUBLESHOOTING */}
          <section id="troubleshooting" className="scroll-mt-20">
            <h2 className="text-title text-ink">Troubleshooting</h2>

            <div className="mt-4 space-y-4">
              <Issue
                q="Registration fails with 'Error sending confirmation email'"
                a="Email confirmations are ON but SMTP is not configured. Either disable Confirm email in Supabase Dashboard → Authentication → Sign In / Providers, or configure a custom SMTP provider (Brevo, Resend) under Authentication → SMTP Settings."
              />
              <Issue
                q="Signup returns 'email_not_confirmed' on sign in"
                a="Confirm email is ON and the user hasn't clicked the confirmation link. Either disable confirmations for development, or check the user's inbox (including spam). You can manually confirm a user in Supabase Dashboard → Authentication → Users."
              />
              <Issue
                q="Sync not working cross-device"
                a="1) Ensure setup_all.sql was run in Supabase SQL Editor. 2) Check that both devices are signed into the same account. 3) Verify RLS policies — run a query in SQL Editor to confirm tables return rows for authenticated users. 4) Hard refresh to load latest service worker."
              />
              <Issue
                q="Tasks disappear after switching accounts"
                a="Guest data lives under a reserved user ID and is never mixed with cloud accounts. If you signed in and don't see your guest tasks, sign out and use 'Claim guest data' in Settings before signing in again."
              />
              <Issue
                q="PWA not updating after deploy"
                a="The service worker auto-updates via skipWaiting(). If it doesn't, hard refresh (Ctrl+Shift+R). Check Application → Service Workers in DevTools for the active version. Cache version is in public/sw.js."
              />
              <Issue
                q="Service worker error: 'chrome-extension request scheme unsupported'"
                a="Fixed in sw.js v2. Ensure the latest deploy is live. The SW now skips non-http(s) protocols and chrome-extension requests."
              />
              <Issue
                q="Capacitor: 'web assets directory must contain index.html'"
                a="Run npm run build first to generate out/, then npx cap sync. The capacitor.config.ts uses webDir: 'out'."
              />
              <Issue
                q="iOS: 'Skipping pod install'"
                a="Install CocoaPods: brew install cocoapods, then npx cap sync ios."
              />
            </div>
          </section>

          <hr className="my-10 border-line" />

          {/* ARCHITECTURE */}
          <section id="architecture" className="scroll-mt-20">
            <h2 className="text-title text-ink">Architecture</h2>
            <p className="mt-2 text-body text-ink-secondary">
              Full architecture details in <code className="font-mono text-mono text-accent">docs/ARCHITECTURE.md</code>.
              Summary:
            </p>

            <CodeBlock
              label="System shape"
              lines={[
                'UI (Next.js static export; Capacitor shell)',
                '  reads from IndexedDB, never blocks on network',
                '    │',
                '    ▼',
                'Application services (src/features/*/service.ts)',
                '  validation · orchestration · writes local + enqueues',
                '    │',
                '    ▼',
                'Dexie / IndexedDB — source of truth for UI',
                '  tasks · projects · tags · subtasks · mutations',
                '    │',
                '    ▼',
                'Sync engine (src/features/sync/)',
                '  push mutations · pull revisions · conflicts',
                '    │',
                '    ▼',
                'Supabase Auth → Supabase Postgres (RLS enforced)',
              ]}
            />

            <h3 className="mt-6 text-body font-semibold text-ink">Key decisions</h3>
            <ul className="mt-2 space-y-2 text-body text-ink-secondary">
              <li className="flex gap-2">
                <span className="text-accent">▸</span>
                <span>
                  <strong className="text-ink">Static export</strong> — no server runtime. All
                  trust lives in Postgres RLS.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-accent">▸</span>
                <span>
                  <strong className="text-ink">Client-generated UUIDv4</strong> — makes creates
                  idempotent under retry.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-accent">▸</span>
                <span>
                  <strong className="text-ink">Server-authoritative revision</strong> — device
                  clocks are never trusted for conflict resolution.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-accent">▸</span>
                <span>
                  <strong className="text-ink">Soft deletes + 90-day tombstones</strong> — prevents
                  resurrection of deleted rows from offline devices.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-accent">▸</span>
                <span>
                  <strong className="text-ink">Idempotency keys</strong> — every mutation is safe
                  to retry. A confirmed result_revision is the only signal of completion.
                </span>
              </li>
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/"
                className="rounded-control bg-accent px-4 py-2 text-body font-medium text-accent-fg hover:bg-accent-hover"
              >
                Open App
              </Link>
              <a
                href="https://github.com/reipand/todowork"
                target="_blank"
                rel="noreferrer"
                className="rounded-control border border-line-strong px-4 py-2 text-body font-medium text-ink hover:bg-sunken"
              >
                GitHub
              </a>
            </div>
          </section>

          <footer className="mt-12 border-t border-line pt-6 text-meta text-ink-muted">
            Todowork — Organize your tasks. Own your time.
          </footer>
        </main>
      </div>
    </div>
  );
}

/* ---------- UI helpers ---------- */

function CodeBlock({ label, lines }: { label?: string; lines: string[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-card border border-line">
      {label && (
        <div className="border-b border-line bg-sunken px-3 py-1.5 text-meta font-medium text-ink-muted">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto bg-surface px-4 py-3">
        <code className="font-mono text-mono text-ink">
          {lines.join('\n')}
        </code>
      </pre>
    </div>
  );
}

function Step({ num, title, body }: { num: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-meta font-semibold text-accent-fg">
        {num}
      </div>
      <div className="min-w-0">
        <div className="text-body font-semibold text-ink">{title}</div>
        <p className="mt-0.5 text-body text-ink-secondary">{body}</p>
      </div>
    </div>
  );
}

function Issue({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-card border border-line bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-body font-medium text-ink hover:bg-sunken">
        <span className="mr-2 text-accent">Q.</span>
        {q}
      </summary>
      <div className="border-t border-line px-4 py-3 text-body text-ink-secondary">
        <span className="mr-2 font-medium text-success">A.</span>
        {a}
      </div>
    </details>
  );
}
