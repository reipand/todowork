import type { NextConfig } from 'next';

/**
 * Todowork build configuration.
 *
 * Rendering mode: **static export** (`output: 'export'`).
 *
 * Why: the product must run offline-first on the web, as an installed PWA, and as a
 * Capacitor Android/iOS app from bundled assets. A static export produces a directory of
 * files that (a) Nginx serves directly with no Node runtime on the VPS, and (b) Capacitor
 * bundles verbatim as `webDir`. A single artifact serves all three targets.
 *
 * Consequence to be aware of when reading this codebase: there is no Next.js server at
 * runtime. Therefore there are **no route handlers, no server actions, and no middleware**.
 * Anything needing server trust must live in Supabase (RLS + policies), which is also the
 * correct trust boundary for a multi-device app. See docs/ARCHITECTURE.md.
 *
 * `images.unoptimized` is required because the Next image optimizer is a server feature and
 * does not exist in an export. Icons are pre-sized static assets instead.
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Trailing slashes make the exported directory structure map cleanly onto Nginx `try_files`
  // and onto Capacitor's file-based asset loading, without needing rewrite rules.
  trailingSlash: true,
  eslint: {
    dirs: ['src', 'tests'],
  },
  typescript: {
    // Fail the build on type errors rather than shipping them. The whole point of
    // `strict: true` is lost if the production build ignores it.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
