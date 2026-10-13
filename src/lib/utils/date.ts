/**
 * Timezone-safe date handling.
 *
 * The rule this module exists to enforce:
 *
 *   A task's `due_date` is a CALENDAR DAY, not an instant.
 *
 * "Due on the 14th" means the 14th in the user's local calendar. If that value is ever routed
 * through a UTC conversion, a user in UTC+7 sees the 14th while a user in UTC-8 sees the 13th,
 * for the same stored value. That off-by-one is the single most common date bug in a todo app,
 * so this module never converts a calendar date to an instant and back.
 *
 * Representations used throughout the codebase:
 *   - Calendar day: `YYYY-MM-DD` string, no time, no zone. Used for due_date / start_date.
 *   - Instant: ISO-8601 UTC string. Used for created_at, completed_at, reminder_at.
 *
 * `new Date('2026-01-14')` is deliberately NOT used for parsing a calendar date, because that
 * constructor form is spec'd to parse as UTC midnight, which is exactly the bug. `parseCalendarDate`
 * below constructs a local-midnight Date instead.
 */

/** Pads to two digits without relying on locale formatting. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Formats a Date as a local-calendar `YYYY-MM-DD` string.
 *
 * Reads the *local* year/month/day components rather than using `toISOString()`, which would
 * shift the date across midnight for anyone east or west of UTC.
 */
export function toCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today as a local calendar date. */
export function todayCalendarDate(): string {
  return toCalendarDate(new Date());
}

/**
 * Parses a calendar date into a Date at local midnight.
 *
 * Local midnight is the correct choice: it is the boundary a calendar UI draws, and it keeps
 * comparisons, week bucketing, and grid placement consistent with what the user sees.
 */
export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/** The current instant as an ISO-8601 UTC string, for instant-typed fields. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Whole days between two calendar dates, computed on local midnights.
 *
 * Positive means `target` is in the future relative to `from`. Used for "due in 3 days" and
 * for overdue detection, both of which must agree with the calendar, not with elapsed hours.
 */
export function daysBetweenCalendarDates(from: string, to: string): number {
  const fromMs = parseCalendarDate(from).getTime();
  const toMs = parseCalendarDate(to).getTime();
  const msPerDay = 86_400_000;
  return Math.round((toMs - fromMs) / msPerDay);
}

/** True when the calendar date is strictly before today. */
export function isOverdue(dueDate: string | null, completed: boolean): boolean {
  if (!dueDate || completed) return false;
  return daysBetweenCalendarDates(todayCalendarDate(), dueDate) < 0;
}

/** True when the calendar date is today. */
export function isDueToday(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return dueDate === todayCalendarDate();
}

/**
 * Shifts a calendar date by whole days, returning a calendar date.
 *
 * Operates on the local-local Date produced by `parseCalendarDate`, so adding one day always
 * lands on the next calendar day even across a DST transition, where a naive
 * "add 86400000ms" would land on 23:00 the same day or 01:00 the next.
 */
export function addCalendarDays(value: string, days: number): string {
  const date = parseCalendarDate(value);
  date.setDate(date.getDate() + days);
  return toCalendarDate(date);
}

/** Shifts the current day by whole days. */
export function addDaysFromToday(days: number): string {
  return addCalendarDays(todayCalendarDate(), days);
}

/**
 * First day of the week containing `value`.
 *
 * Week starts Monday, matching ISO-8601 and the majority of locales this app targets. Hardcoded
 * rather than locale-derived because the week view's column order must be stable across devices
 * in a multi-device sync product; a per-user week start would make two devices disagree about
 * what "this week" contains, which would make the weekly productivity figure inconsistent.
 */
export function startOfWeek(value: string): string {
  const date = parseCalendarDate(value);
  const dayIndex = date.getDay(); // 0 = Sunday
  const offsetToMonday = dayIndex === 0 ? -6 : 1 - dayIndex;
  date.setDate(date.getDate() + offsetToMonday);
  return toCalendarDate(date);
}

/** Last day of the week containing `value`. */
export function endOfWeek(value: string): string {
  return addCalendarDays(startOfWeek(value), 6);
}

/** First day of the month containing `value`. */
export function startOfMonth(value: string): string {
  const date = parseCalendarDate(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-01`;
}

/** Last day of the month containing `value`. */
export function endOfMonth(value: string): string {
  const date = parseCalendarDate(value);
  // Day 0 of the next month is the last day of this one, which handles leap Februaries
  // without a lookup table.
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return toCalendarDate(lastDay);
}

/** Shifts by whole months, clamping to a valid day (Jan 31 + 1 month = Feb 28/29). */
export function addCalendarMonths(value: string, months: number): string {
  const date = parseCalendarDate(value);
  const targetMonth = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
  const normalisedMonth = ((targetMonth % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, normalisedMonth + 1, 0).getDate();
  const clampedDay = Math.min(date.getDate(), daysInTargetMonth);
  return `${targetYear}-${pad2(normalisedMonth + 1)}-${pad2(clampedDay)}`;
}

/** Inclusive list of calendar dates from `from` to `to`. Used to build the month grid. */
export function calendarDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  // Guard against a runaway loop if the caller passes a reversed range.
  let guard = 0;
  const maxGuard = 1000;

  while (cursor <= to && guard < maxGuard) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
    guard += 1;
  }

  return dates;
}

/**
 * Human-readable relative label for a due date.
 *
 * Returns vocabulary rather than a raw date for the near term, because "Today" is what the user
 * is actually tracking and it removes a mental date-parse. Falls back to a formatted date beyond
 * a week, where a relative label would be less precise than the date itself.
 */
export function formatDueDate(dueDate: string | null, locale = 'en-US'): string {
  if (!dueDate) return 'No date';

  const delta = daysBetweenCalendarDates(todayCalendarDate(), dueDate);

  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta <= 6) {
    return parseCalendarDate(dueDate).toLocaleDateString(locale, { weekday: 'long' });
  }
  if (delta < -1 && delta >= -6) {
    return `${Math.abs(delta)} days ago`;
  }

  const date = parseCalendarDate(dueDate);
  // Include the year only when it differs, to keep the common case short.
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Full date for the task detail panel, where precision matters more than brevity. */
export function formatFullDate(value: string | null, locale = 'en-US'): string {
  if (!value) return 'None';
  // Distinguish a calendar date from an instant so each is formatted in its own terms.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseCalendarDate(value).toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  return new Date(value).toLocaleString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format for the activity feed and sync status, where a relative instant reads better. */
export function formatRelativeInstant(iso: string | null, locale = 'en-US'): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  const seconds = Math.floor((Date.now() - then) / 1000);

  if (seconds < 45) return 'Just now';
  if (seconds < 90) return 'A minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * Converts a `datetime-local` input value (local wall time, no zone) to a UTC instant.
 *
 * This is the one place a local wall-clock value legitimately becomes an instant: a reminder is
 * a moment in time, not a calendar day. The conversion is explicit rather than implicit, and it
 * is why reminders and due dates use different helpers.
 */
export function localDateTimeToIso(localValue: string): string {
  // `new Date('2026-01-14T09:30')` is parsed as local time by spec, which is what we want here.
  return new Date(localValue).toISOString();
}

/** Converts a UTC instant to a `datetime-local` input value in the user's local zone. */
export function isoToLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}
