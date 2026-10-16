import { ProjectDetailClient } from './project-detail-client';

/**
 * Project detail.
 *
 * Static export note. A dynamic segment under `output: 'export'` requires `generateStaticParams`,
 * and a task app's project ids are generated on the client, so they cannot be enumerated at build
 * time. The single sentinel param `{ id: '_' }` makes the route export successfully; the real id is
 * read from the URL at runtime by the client component.
 *
 * For the exported site to serve arbitrary `/projects/<id>/` paths, the host needs a fallback to
 * the generated `projects/_/index.html`. Nginx: `try_files $uri $uri/ /projects/_/index.html;`
 * inside `location /projects/`. Capacitor serves the bundle and resolves unknown paths the same
 * way with its own `server.androidScheme` handling. Both are documented in docs/DEPLOYMENT.md.
 *
 * In `next dev` no fallback is needed — the dev server resolves every id directly.
 */
export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function ProjectDetailPage() {
  return <ProjectDetailClient />;
}
