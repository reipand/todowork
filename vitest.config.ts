import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Vitest configuration.
 *
 * Two environments are needed and the split is deliberate:
 *   - `jsdom` for anything touching the DOM or IndexedDB (services, hooks, components).
 *   - `node` for the pure-logic suites, where a DOM adds startup cost and can mask a module that
 *     accidentally depends on `window`.
 *
 * `tests/unit` and `tests/integration` are separated rather than interleaved so the faster unit
 * suite can be run alone during development (`npm run test:unit`).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Both are required for the Dexie suites: `fake-indexeddb` supplies the storage engine and the
    // setup file installs it onto the global scope before any test imports the database module.
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
