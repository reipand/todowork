'use client';

import { useEffect, useRef, useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * Dialog.
 *
 * Built on the native `<dialog>` element rather than a div-based modal. That choice buys real
 * behaviour instead of reimplementing it:
 *   - focus trapping is handled by the platform
 *   - Escape closes it natively
 *   - it renders in the top layer, so no z-index war with the sidebar or popovers
 *   - `::backdrop` is available for the scrim
 *
 * The parts the platform does NOT handle, and which are therefore implemented here: returning focus
 * to the element that opened the dialog, and preventing background scroll.
 *
 * The spec's accessibility target requires Escape-to-close and visible focus, both of which this
 * satisfies by construction.
 */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Rendered under the title. Optional: some dialogs are a single question. */
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** 'default' is a centred card. 'sheet' is a bottom sheet, for editing on a phone. */
  variant?: 'default' | 'sheet';
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'default',
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Tracks the trigger so focus can be restored to it. Without this a keyboard user is dumped back
  // at the top of the document after closing.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      // Lock background scroll. Without this, a phone user can scroll the page behind the sheet.
      document.body.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.style.overflow = '';
      previouslyFocusedRef.current?.focus();
    }
  }, [open]);

  // Clear the scroll lock if the component unmounts while open, which would otherwise leave the page
  // permanently unscrollable.
  useEffect(() => {
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // `onClose` fires for the native Escape key and for form-method-dialog, so both paths route
      // through the same callback and React state can never drift from the DOM's open state.
      onClose={onClose}
      // Dismiss on backdrop click: the backdrop is part of the dialog element, so a click whose
      // target is the dialog itself is a click outside the content.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        'w-full max-w-lg border border-line bg-surface p-0 text-ink',
        'backdrop:bg-black/40 dark:backdrop:bg-black/60',
        variant === 'sheet'
          ? // Bottom sheet: pinned to the bottom on small screens, centred from `sm` up. The
            // `mt-auto` / `mb-0` pair is what pins it, so it lives in the class list rather than in
            // an inline style that would fight the max-height rule below.
            'mt-auto mb-0 max-w-full rounded-t-panel rounded-b-none sm:mt-auto sm:mb-auto sm:max-w-lg sm:rounded-panel'
          : 'rounded-panel',
        className,
      )}
      // Caps the height so a long form scrolls inside the dialog instead of overflowing the viewport.
      // `dvh` rather than `vh` so a mobile browser's collapsing toolbar does not clip the footer.
      style={{ maxHeight: '90dvh' }}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-title text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-body text-ink-secondary">
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            // An icon-only control must carry an accessible name. This is the label-less-button
            // failure mode that antislop R-26 and the a11y requirements both call out.
            aria-label="Close dialog"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-hover hover:bg-sunken hover:text-ink"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="h-4 w-4"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {children ? <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div> : null}

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-sunken/50 px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}

/**
 * Confirmation dialog.
 *
 * A thin wrapper for the most common dialog shape: a question with a confirm/cancel pair. Used for
 * destructive actions, which the spec requires to be confirmed (bulk delete, project delete, account
 * deletion).
 *
 * The confirm label is a required prop rather than a default of "OK". A vague confirm label on a
 * destructive action is how users delete things by accident; naming the action is the safeguard.
 */
export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 rounded-control border border-line-strong bg-surface px-3.5 text-body font-medium text-ink transition-colors duration-hover hover:bg-sunken disabled:opacity-55"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className={cn(
              'h-9 rounded-control px-3.5 text-body font-medium transition-opacity duration-hover disabled:opacity-55',
              tone === 'danger'
                ? 'bg-danger text-white hover:opacity-90'
                : 'bg-accent text-accent-fg hover:bg-accent-hover',
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
