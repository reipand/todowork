import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * `twMerge` matters here specifically because reusable components accept a `className`
 * override. Without it, `<Button className="bg-danger">` would produce both `bg-accent` and
 * `bg-danger` in the class list, and the winner would depend on stylesheet order rather than
 * on the caller's intent.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Deterministic, collision-resistant id for new local rows.
 *
 * Generated on the client so a task can exist offline. Uniqueness comes from the platform
 * CSPRNG, which is available in every target environment (browsers, WebView, Node >= 19).
 *
 * The fallback exists for a non-secure context, where `crypto.randomUUID` is unavailable. It
 * is deliberately not used in production: `Math.random` is not cryptographically random, and
 * while a task id is not a secret, predictable ids make accidental collisions more likely
 * than the alternative. Prefer fixing the deployment (HTTPS) over relying on the fallback.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // Set version 4 and variant bits so the result is a well-formed UUID.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error(
    'Secure random number generation is unavailable. Ensure the app is served over HTTPS ' +
      '(required for PWA installation anyway) so crypto.randomUUID is available.',
  );
}

/**
 * Key for the mutation idempotency ledger.
 *
 * UUID plus a timestamp prefix: the UUID guarantees uniqueness against other mutations, and the
 * prefix makes the ledger roughly time-ordered when read during debugging, which matters when
 * diagnosing a retry storm.
 */
export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${newId()}`;
}

/** Extracts a human message from an unknown thrown value, without leaking internals. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return 'An unexpected error occurred';
}

/**
 * Truncates long text for use in a task row, on a grapheme boundary.
 *
 * Uses `Intl.Segmenter` when available so an emoji or an accented character is never cut in
 * half, which would render as a replacement glyph.
 */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let result = '';
    for (const { segment } of segmenter.segment(value)) {
      if (result.length + segment.length > maxLength - 1) break;
      result += segment;
    }
    return `${result}…`;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

/** Clamps a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Groups items by a derived key.
 *
 * Returns a Map rather than an object so iteration order is insertion order, which the grouped
 * task list depends on for a stable render.
 */
export function groupBy<T, K extends string>(items: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

/**
 * Trailing debounce. Used for search input so a keystroke does not trigger a query per
 * character, and for the sync-on-visibility handler so a fast tab switch does not fire twice.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (...args: Args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
}

/**
 * Backoff schedule for sync retry.
 *
 * Exponential with jitter, capped. The jitter is not cosmetic: without it, every device that
 * queued a mutation during an outage would retry at the same instant when connectivity returns,
 * producing a thundering herd against the same handful of rows.
 *
 * The cap keeps a long-offline device from waiting hours after the network comes back, and the
 * attempt cap prevents an infinite retry loop (spec §6).
 */
export function computeBackoffMs(retryCount: number, baseMs = 1000, maxMs = 5 * 60 * 1000): number {
  const exponential = Math.min(baseMs * 2 ** retryCount, maxMs);
  // Full jitter: uniform between 50% and 100% of the computed delay.
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.round(exponential * jitter);
}

/** Maximum retry attempts before a mutation is parked as failed for manual retry. */
export const MAX_MUTATION_RETRIES = 8;
