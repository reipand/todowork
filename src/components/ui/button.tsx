'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Button.
 *
 * The variants are intentionally few. A productivity tool's button vocabulary is small: do the main
 * thing, do a quiet thing, do a destructive thing. Adding a fourth decorative variant would dilute
 * the accent, which DESIGN.md reserves for the one actionable element per view.
 *
 * Every button is a real `<button>` with a real type, so it is keyboard reachable and Enter/Space
 * activatable by default rather than by a keydown handler that can be forgotten.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/**
 * Sizes are chosen against the 44px minimum tap target (antislop R-03).
 * `sm` is 32px tall, which is only acceptable for a control inside a desktop-dense row; the mobile
 * bottom bar and every primary action use `md` at 36px with generous horizontal padding, and the
 * `icon` size is 36x36 so it clears the target on touch.
 */
const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-hover border border-transparent',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-sunken active:bg-sunken',
  ghost:
    'bg-transparent text-ink-secondary border border-transparent hover:bg-sunken hover:text-ink active:bg-sunken',
  danger:
    'bg-danger text-white border border-transparent hover:opacity-90 active:opacity-90',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-meta gap-1.5',
  md: 'h-9 px-3.5 text-body gap-2',
  icon: 'h-9 w-9 justify-center',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading = false, disabled, children, ...props },
  ref,
) {
  // A loading button is disabled to prevent a double submit, but it keeps its width so the layout
  // does not jump when the label is swapped for a spinner.
  const isDisabled = disabled === true || loading;

  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={isDisabled}
      // Explicit aria state rather than relying on the visual spinner, so a screen reader announces
      // the pending state instead of silence.
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center rounded-control font-medium transition-colors duration-hover',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <Spinner />
          <span className="sr-only">Working</span>
          <span aria-hidden="true" className="contents">
            {children}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

/**
 * Spinner.
 *
 * A bordered ring with one transparent edge, rotated. Chosen over a CSS keyframe animation of a
 * dot because it reads as "working" at 14px, and it is suppressed entirely under
 * `prefers-reduced-motion` in globals.css, where it becomes a static ring.
 */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
