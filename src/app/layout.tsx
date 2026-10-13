import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';

import { AppProviders } from '@/components/layout/app-providers';
import '@/styles/tokens.css';
import './globals.css';

/**
 * Root layout.
 *
 * Two fonts, loaded via `next/font` so they are self-hosted and inlined into the build. Self-hosting
 * matters for an offline-first app: a font fetched from a third-party CDN would fail to render on a
 * first load with no connection, and would also be a cross-origin request the service worker would
 * have to special-case.
 *
 * Inter carries the UI (chosen for its complete tabular numeral set and alternative glyphs).
 * JetBrains Mono carries only tabular figures, so counts and timestamps do not reflow as they change.
 * Both reasons are recorded in DESIGN.md.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  // `default` is the pattern used by any route that does not set its own title.
  title: {
    default: 'Todowork',
    template: '%s · Todowork',
  },
  description: 'Organize your tasks. Own your time.',
  applicationName: 'Todowork',
  manifest: '/manifest.webmanifest',
  // iOS ignores the web manifest for several home-screen behaviours, so these are set explicitly.
  appleWebApp: {
    capable: true,
    title: 'Todowork',
    statusBarStyle: 'default',
  },
  formatDetection: {
    // Prevents iOS from turning a date or a long number in a task description into a phone link.
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `viewport-fit=cover` is required for `env(safe-area-inset-*)` to report real values on a notched
  // device. Without it the bottom navigation would sit under the home indicator.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBFAF8' },
    { media: '(prefers-color-scheme: dark)', color: '#141413' },
  ],
  // Locking zoom is deliberately NOT done: pinch-zoom is an accessibility affordance, and disabling
  // it fails WCAG 1.4.4. A denser 14px body is compensated with generous spacing instead.
};

/**
 * Inline script that applies the stored theme before first paint.
 *
 * Without this, a dark-mode user sees a white flash on every load, because the theme class would only
 * be applied after React hydrates. Running it inline in `<head>` is the standard remedy and is why it
 * must be a raw string rather than a component.
 *
 * Wrapped in try/catch because `localStorage` throws in some privacy modes, and a theme read must
 * never break the app.
 */
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('todowork.theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark' ? stored : (prefersDark ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (error) {
    /* Storage unavailable: fall through to the light default. */
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-paper font-sans antialiased">
        {/*
          A skip link. The sidebar has a dozen navigation links before the main content, so a keyboard
          user needs a way past them. This is the standard remedy and it is required for the
          accessibility target.
        */}
        <a
          href="#main-content"
          className="sr-only-focusable absolute left-4 top-4 z-50 rounded-control bg-accent px-3 py-2 text-body font-medium text-accent-fg"
        >
          Skip to main content
        </a>

        <AppProviders>{children}</AppProviders>

        <SpeedInsights />
      </body>
    </html>
  );
}
