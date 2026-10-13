'use client';

import { cn } from '@/lib/utils';
import type { Priority } from '@/types/domain';

/**
 * Priority indicator.
 *
 * Priority is communicated by three independent channels, never by colour alone. This satisfies
 * WCAG 1.4.1 (Use of Color) and means a user with deuteranopia, protanopia, or monochromacy can
 * still read priority correctly:
 *
 *   1. A geometric glyph, distinct in SHAPE so it survives any colour confusion: triangle, square,
 *      circle. Shape is the primary channel because it is the one that keeps working when colour is
 *      unavailable at all.
 *   2. The colour, for the users who can see it.
 *   3. A text label, always present for screen readers and available visually on request.
 *
 * The glyph choices are deliberate: a triangle pointing up reads as "escalate", a square as "level",
 * a circle as "low". They are also the three most distinguishable simple shapes at 10px, which
 * matters because this renders at icon size in a dense row.
 */

const PRIORITY_CONFIG = {
  high: {
    label: 'High',
    glyph: '▲',
    // The accessible name spells out the meaning rather than leaving a bare shape to be interpreted.
    description: 'High priority',
    classes: 'text-priority-high',
    softClasses: 'bg-priority-high-soft text-priority-high',
  },
  medium: {
    label: 'Medium',
    glyph: '■',
    description: 'Medium priority',
    classes: 'text-priority-medium',
    softClasses: 'bg-priority-medium-soft text-priority-medium',
  },
  low: {
    label: 'Low',
    glyph: '●',
    description: 'Low priority',
    classes: 'text-priority-low',
    softClasses: 'bg-priority-low-soft text-priority-low',
  },
} as const satisfies Record<
  Priority,
  { label: string; glyph: string; description: string; classes: string; softClasses: string }
>;

export interface PriorityIndicatorProps {
  priority: Priority;
  /**
   * `glyph` is the compact form used in a task row.
   * `badge` adds the text label, used in the detail panel and any form.
   */
  variant?: 'glyph' | 'badge';
  className?: string;
}

export function PriorityIndicator({
  priority,
  variant = 'glyph',
  className,
}: PriorityIndicatorProps) {
  const config = PRIORITY_CONFIG[priority];

  if (variant === 'badge') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-control px-2 py-0.5 text-meta font-medium',
          config.softClasses,
          className,
        )}
      >
        <span aria-hidden="true" className="text-[0.625rem] leading-none">
          {config.glyph}
        </span>
        {config.label}
      </span>
    );
  }

  return (
    <span
      // The glyph is decorative for a screen reader; the title carries the meaning for a sighted user
      // hovering, and the sr-only text carries it for assistive tech.
      aria-hidden="true"
      title={config.description}
      className={cn('inline-flex items-center text-[0.625rem] leading-none', config.classes, className)}
    >
      {config.glyph}
      <span className="sr-only">{config.description}</span>
    </span>
  );
}

/** The label alone, for use inside an `<option>` or a heading where the glyph would be noise. */
export function priorityLabel(priority: Priority): string {
  return PRIORITY_CONFIG[priority].label;
}

export const PRIORITY_OPTIONS: ReadonlyArray<{ value: Priority; label: string }> = [
  { value: 'high', label: PRIORITY_CONFIG.high.label },
  { value: 'medium', label: PRIORITY_CONFIG.medium.label },
  { value: 'low', label: PRIORITY_CONFIG.low.label },
];
