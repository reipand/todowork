'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Text fields.
 *
 * The accessibility contract is fixed here once, so no form has to reimplement it:
 *   - every control has an associated label element, linked by id
 *   - an error is announced via `role="alert"` and linked with `aria-describedby`
 *   - `aria-invalid` is set, so a screen reader reports the field as invalid rather than only
 *     reading the error text after it
 *   - only one of hint/error is linked, because pointing `aria-describedby` at two nodes makes the
 *     announcement order unpredictable. The error wins when both are present: it is actionable.
 *
 * Getting this right per-form is how accessibility regresses, so it lives in the component.
 */

interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

function FieldShell({ id, label, error, hint, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-meta font-medium text-ink-secondary">
        {label}
      </label>

      {children}

      {hint && !error ? (
        <p id={`${id}-hint`} className="text-meta text-ink-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        // `role="alert"` announces it on appearance, which is what a user who just pressed submit
        // needs. A plain paragraph would leave them waiting with no feedback.
        <p id={`${id}-error`} role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Builds the `aria-describedby` value, or undefined so React omits the attribute entirely. */
function describedByFor(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

/** Stable, readable id derived from the label when the caller does not supply one. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const CONTROL_CLASSES = [
  'w-full rounded-control border bg-surface text-body text-ink',
  'placeholder:text-ink-muted',
  'transition-colors duration-hover',
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-muted',
];

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className, ...props },
  ref,
) {
  const inputId = id ?? `input-${slugify(label)}`;

  return (
    <FieldShell id={inputId} label={label} error={error} hint={hint}>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByFor(inputId, error, hint)}
        className={cn(
          CONTROL_CLASSES,
          'h-9 px-3',
          error ? 'border-danger' : 'border-line-strong',
          className,
        )}
        {...props}
      />
    </FieldShell>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id, className, rows = 4, ...props },
  ref,
) {
  const textareaId = id ?? `textarea-${slugify(label)}`;

  return (
    <FieldShell id={textareaId} label={label} error={error} hint={hint}>
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByFor(textareaId, error, hint)}
        className={cn(
          CONTROL_CLASSES,
          'resize-y px-3 py-2',
          error ? 'border-danger' : 'border-line-strong',
          className,
        )}
        {...props}
      />
    </FieldShell>
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
}

/**
 * Native select.
 *
 * Deliberately native rather than a custom listbox: the native control has correct keyboard and
 * screen-reader behaviour on every platform this ships to, including the mobile WebView, and a
 * hand-rolled dropdown would be a large amount of code to re-implement it worse.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, id, className, children, ...props },
  ref,
) {
  const selectId = id ?? `select-${slugify(label)}`;

  return (
    <FieldShell id={selectId} label={label} error={error} hint={hint}>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByFor(selectId, error, hint)}
        className={cn(
          CONTROL_CLASSES,
          'h-9 px-2.5',
          error ? 'border-danger' : 'border-line-strong',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});
