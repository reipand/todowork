'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker and auto-activates new versions.
 *
 * On `updatefound` the new worker is prompted to `skipWaiting`, and on
 * `controllerchange` the page reloads — so a deployed update appears on the
 * next navigation without the user needing to close and reopen the PWA.
 *
 * `updateViaCache: 'none'` ensures the browser always fetches the latest
 * `sw.js` byte-for-byte on every navigation, not a cached copy.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let reloading = false;

    const register = (): void => {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          // Check for update on mount and when the tab becomes visible again.
          void registration.update();

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version downloaded — activate it immediately.
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch(() => {
          // Registration failed — not critical, app works without SW.
        });
    };

    register();

    // Re-check for updates when the tab becomes visible (user returns to PWA).
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg) void reg.update();
        }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Reload when the new service worker takes control.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
