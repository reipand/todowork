/**
 * Natural-language quick-add parser.
 *
 * Extracts due dates and priority from a free-text title so a user can type
 * "Meeting tomorrow #high" and get a task titled "Meeting" due tomorrow with
 * high priority — no form fields touched.
 *
 * No external dependency. Supports a deliberate subset of natural language:
 *   - Dates: today, tomorrow, weekday names, "next week"
 *   - Priority: #high / #1, #medium / #2, #low / #3
 *
 * The remaining text (with parsed tokens removed) becomes the task title.
 * Tokens are stripped from wherever they appear, so "tomorrow buy milk" and
 * "buy milk tomorrow" both work.
 */

import { todayCalendarDate } from '@/lib/utils/date';
import type { Priority } from '@/types/domain';

export interface ParsedQuickAdd {
  title: string;
  due_date: string | null;
  priority: Priority | null;
}

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Returns YYYY-MM-DD for a Date in local time. */
function formatCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Next occurrence of a weekday (including today if today matches). */
function nextWeekday(dayName: string): string | null {
  const target = WEEKDAY_NAMES.indexOf(dayName.toLowerCase());
  if (target === -1) return null;

  const now = new Date();
  const current = now.getDay();
  let diff = target - current;
  if (diff < 0) diff += 7;

  const date = new Date(now);
  date.setDate(now.getDate() + diff);
  return formatCalendarDate(date);
}

function tomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatCalendarDate(d);
}

function nextWeekDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return formatCalendarDate(d);
}

const PRIORITY_MAP: Record<string, Priority> = {
  '#high': 'high',
  '#h': 'high',
  '#1': 'high',
  '#medium': 'medium',
  '#med': 'medium',
  '#m': 'medium',
  '#2': 'medium',
  '#low': 'low',
  '#l': 'low',
  '#3': 'low',
};

const DATE_PATTERNS: Array<{ regex: RegExp; resolve: (match: string) => string | null }> = [
  { regex: /\btoday\b/i, resolve: () => todayCalendarDate() },
  { regex: /\btomorrow\b|\btmrw\b|\btmr\b/i, resolve: () => tomorrowDate() },
  { regex: /\bnext\s*week\b/i, resolve: () => nextWeekDate() },
  {
    regex: new RegExp(`\\b(${WEEKDAY_NAMES.join('|')})\\b`, 'i'),
    resolve: (match) => nextWeekday(match),
  },
];

/**
 * Parses a free-text string into a title, optional due date, and optional priority.
 *
 * Tokens are removed from the title in the order they are found. If a date keyword
 * is part of a longer word (e.g. "Fri" in "Friday meeting"), the whole word is
 * matched because the regex uses word boundaries.
 */
export function parseQuickAdd(input: string): ParsedQuickAdd {
  let text = input.trim();
  let dueDate: string | null = null;
  let priority: Priority | null = null;

  // Extract priority hashtag (#high, #1, etc.)
  const priorityMatch = text.match(/#[a-z0-9]+/i);
  if (priorityMatch) {
    const key = priorityMatch[0].toLowerCase();
    const mapped = PRIORITY_MAP[key];
    if (mapped) {
      priority = mapped;
      text = text.replace(priorityMatch[0], '').replace(/\s+/g, ' ').trim();
    }
  }

  // Extract date keyword
  for (const { regex, resolve } of DATE_PATTERNS) {
    if (dueDate) break;
    const match = text.match(regex);
    if (match) {
      const resolved = resolve(match[0]);
      if (resolved) {
        dueDate = resolved;
        text = text.replace(match[0], '').replace(/\s+/g, ' ').trim();
      }
    }
  }

  return { title: text, due_date: dueDate, priority };
}
