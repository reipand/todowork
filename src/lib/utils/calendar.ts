/**
 * iCalendar (.ics) and Google Calendar URL generation.
 *
 * Both functions prefer `reminder_at` (a precise instant) over `due_date` (a calendar day)
 * because a reminder is a moment and a due date is not. When only a due date exists, the
 * event is all-day.
 */

import { addCalendarDays } from '@/lib/utils/date';

/** Characters that must be escaped inside iCalendar property values. */
function escapeICS(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Formats a Date as an iCalendar UTC timestamp: `YYYYMMDDTHHMMSSZ`. */
function formatICSUTC(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Formats a Date as a Google Calendar UTC timestamp: `YYYYMMDDTHHMMSSZ`. */
function formatGoogleUTC(date: Date): string {
  return formatICSUTC(date);
}

/** Converts a `YYYY-MM-DD` calendar date to the compact `YYYYMMDD` form. */
function compactDate(calendarDate: string): string {
  return calendarDate.replace(/-/g, '');
}

interface CalendarEventInput {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  reminder_at: string | null;
}

/** Returns true when there is enough date information to create a calendar event. */
export function hasCalendarEvent(task: Pick<CalendarEventInput, 'due_date' | 'reminder_at'>): boolean {
  return task.due_date !== null || task.reminder_at !== null;
}

/**
 * Generates an iCalendar (.ics) string for a task.
 *
 * Returns null when the task has neither a due date nor a reminder — there is nothing to
 * put on a calendar.
 */
export function generateICS(task: CalendarEventInput): string | null {
  if (!hasCalendarEvent(task)) return null;

  const stamp = formatICSUTC(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Todowork//Task Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${task.id}@todowork`,
    `DTSTAMP:${stamp}`,
  ];

  if (task.reminder_at) {
    // Timed event: start at the reminder, default 1-hour duration.
    const start = new Date(task.reminder_at);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${formatICSUTC(start)}`);
    lines.push(`DTEND:${formatICSUTC(end)}`);
  } else if (task.due_date) {
    // All-day event on the due date. DTEND is exclusive, so it must be the next day.
    lines.push(`DTSTART;VALUE=DATE:${compactDate(task.due_date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addCalendarDays(task.due_date, 1))}`);
  }

  lines.push(`SUMMARY:${escapeICS(task.title)}`);

  if (task.description) {
    lines.push(`DESCRIPTION:${escapeICS(task.description)}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * Builds a Google Calendar "render" URL that pre-fills an event from a task.
 *
 * Returns null when the task has neither a due date nor a reminder.
 */
export function googleCalendarUrl(task: Pick<CalendarEventInput, 'title' | 'description' | 'due_date' | 'reminder_at'>): string | null {
  if (!hasCalendarEvent(task)) return null;

  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', task.title);

  if (task.description) {
    params.set('details', task.description);
  }

  if (task.reminder_at) {
    const start = new Date(task.reminder_at);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    params.set('dates', `${formatGoogleUTC(start)}/${formatGoogleUTC(end)}`);
  } else if (task.due_date) {
    // All-day: start date / next day (exclusive end).
    params.set('dates', `${compactDate(task.due_date)}/${compactDate(addCalendarDays(task.due_date, 1))}`);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Triggers a download of an .ics file. Uses a Blob URL and a temporary anchor, which is the
 * standard pattern for client-side file download without a server round-trip.
 */
export function downloadICS(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
