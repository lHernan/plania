"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";

type ConfirmOptions = {
  message: string;
  /** Label of the destructive action (defaults to "Delete"). */
  confirmLabel?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * In-app replacement for window.confirm: `if (await confirm({ message })) ...`.
 * Render `dialog` once in the component that asks.
 */
export function useConfirmDialog(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const answer = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  return { confirm, dialog: pending ? <ConfirmDialog options={pending} onAnswer={answer} /> : null };
}

function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The safe choice gets the focus, so Enter never deletes by accident.
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onAnswer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  // Portaled to the body: a transformed ancestor (animated modals) would otherwise trap "fixed".
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => onAnswer(false)}>
      <div className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm" aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm space-y-5 rounded-2xl bg-[var(--color-surface)] p-6 shadow-2xl"
      >
        <p id={titleId} className="text-sm font-bold text-[var(--color-text)]">
          {options.message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-xl px-4 py-2 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            {t("confirm_dialog_cancel")}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className="rounded-xl bg-[var(--color-danger)] px-4 py-2 text-xs font-bold text-white hover:opacity-90"
          >
            {options.confirmLabel ?? t("confirm_dialog_delete")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
