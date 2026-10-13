'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Theme context.
 *
 * Three states rather than two: `system` is the default and means "follow the OS". A user who has
 * never expressed a preference should get their OS preference, and only an explicit choice should
 * override it. Storing just light/dark would force a choice on every user on first load.
 *
 * Both themes are fully supported; neither is a degraded mode. See DESIGN.md.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'todowork.theme';

interface ThemeContextValue {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is actually applied right now. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage can be unavailable in a private window. Falling back to `system` is always correct.
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialised from storage rather than defaulted, so the React state agrees with the class the
  // inline head script already applied. A mismatch would produce a hydration warning and a visible
  // flicker back to the wrong theme.
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    typeof window === 'undefined' ? 'system' : readStoredPreference(),
  );

  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : systemPrefersDark(),
  );

  // Track the OS preference live, so a user whose system switches to dark at sunset sees the app
  // follow without a reload, as long as they have not set an explicit preference.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');

    // Keeps the browser chrome (address bar, status bar) in step with the app's surface colour,
    // which matters in the installed PWA and the Capacitor shell where that bar is always visible.
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', resolved === 'dark' ? '#141413' : '#FBFAF8');
    }
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // If storage is unavailable the choice lasts for this session only. The theme still applies;
      // it just will not be remembered, and there is no useful recovery to attempt.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider.');
  }

  return context;
}
