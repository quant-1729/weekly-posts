"use client";

import { useEffect, useId, useRef } from "react";
import { outlineButton, primaryButton } from "@/components/ui";

/**
 * A themed confirmation as a modal alert dialog, for actions that cannot be undone. It uses the browser's own modal
 * `<dialog>`: focus moves into it (to Cancel, the safe choice) and stays inside, the page behind is inert, Escape closes it
 * and focus goes back to the button that opened it. `open` is controlled by the caller; `onClose` is called for Cancel,
 * Escape and a click on the dimmed area.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-confirm-dialog
      // Escape fires "cancel" then "close": keep the caller's state in step with the element.
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose();
      }}
      className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-card border border-line bg-white p-0 text-ink shadow-card backdrop:bg-black/40"
    >
      <div className="space-y-4 p-5 md:p-6">
        <div className="space-y-1.5">
          <h2 id={titleId} className="text-card-title text-title">
            {title}
          </h2>
          <p id={bodyId} className="text-[14px] leading-5 text-desc">
            {body}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={outlineButton} disabled={busy} onClick={onClose} data-dialog-cancel>
            {cancelLabel}
          </button>
          <button type="button" className={primaryButton} disabled={busy} onClick={onConfirm} data-dialog-confirm>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
