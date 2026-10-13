'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

/**
 * Toasts.
 *
 * Used for confirmations that do not warrant a dialog: a task was created, an export finished, a
 * change could not be saved. The container is a live region so a screen reader announces the message
 * without the user having to hunt for it, which is the "screen reader friendly status updates"
 * requirement.
 *
 * Toasts are never the ONLY signal for a failure that needs action. A destructive failure also
 * leaves visible state on screen (a row marked failed, a conflict badge), because a toast that has
 * faded is not a durable record of a problem.
 */

export type ToastTone = 'info' | 'success' | 'danger';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** Optional inline action, such as "Retry" on a failed save. */
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (message: string, options?: { tone?: ToastTone; action?: Toast['action'] }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** How long a toast stays. Long enough to read and to reach the action, short enough not to nag. */
const TOAST_DURATION_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));

    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastContextValue['toast']>(
    (message, options) => {
      // A counter-based id rather than a UUID: this never leaves the tab, and a monotonic counter
      // makes the order obvious while debugging.
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const entry: Toast = {
        id,
        message,
        tone: options?.tone ?? 'info',
        ...(options?.action ? { action: options.action } : {}),
      };

      // Cap the stack. Beyond three, older ones are dropped rather than letting the stack grow into
      // a wall of text that covers the content.
      setToasts((current) => [...current.slice(-2), entry]);

      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  // Clean up pending timers on unmount so a dismissed provider cannot fire setState afterwards.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      // `polite` rather than `assertive`: a confirmation should not interrupt whatever the screen
      // reader is currently saying. Genuine errors also render in-page, so nothing urgent depends on
      // this region.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-safe sm:inset-x-auto sm:right-0 sm:bottom-0 sm:items-end"
    >
      {toasts.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border px-3.5 py-3',
            'shadow-popover',
            entry.tone === 'danger'
              ? 'border-danger/40 bg-danger-soft text-ink'
              : entry.tone === 'success'
                ? 'border-success/40 bg-success-soft text-ink'
                : 'border-line bg-surface text-ink',
          )}
        >
          <p className="flex-1 text-body">{entry.message}</p>

          {entry.action ? (
            <button
              type="button"
              onClick={() => {
                entry.action?.onClick();
                onDismiss(entry.id);
              }}
              className="shrink-0 rounded-control px-2 py-0.5 text-meta font-semibold text-accent transition-colors duration-hover hover:bg-accent-soft"
            >
              {entry.action.label}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => onDismiss(entry.id)}
            aria-label="Dismiss notification"
            className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted transition-colors duration-hover hover:bg-sunken hover:text-ink"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-3 w-3"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider.');
  }

  return context;
}
