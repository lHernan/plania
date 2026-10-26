"use client";

import { CircleAlert, CircleCheck, FileText, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { fileErrorLabel, warningLabel, type FileErrorCode } from "./labels";

export type FileStatus = "queued" | "reading" | "analyzing" | "done" | "error";

export type FileEntry = {
  id: string;
  name: string;
  status: FileStatus;
  error?: FileErrorCode;
  bookingCount: number;
  warnings: string[];
};

export function FileRow({ entry, onRetry, onRemove }: { entry: FileEntry; onRetry: () => void; onRemove: () => void }) {
  const { t } = useI18n();
  const busy = entry.status === "reading" || entry.status === "analyzing" || entry.status === "queued";

  return (
    <li
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
        entry.status === "error"
          ? "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
      data-testid={`file-row-${entry.name}`}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {entry.status === "done" ? (
          <CircleCheck size={18} className="text-[var(--color-success,var(--color-primary))]" />
        ) : entry.status === "error" ? (
          <CircleAlert size={18} className="text-[var(--color-danger)]" />
        ) : busy && entry.status !== "queued" ? (
          <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none text-[var(--color-primary)]" />
        ) : (
          <FileText size={18} className="text-[var(--color-text-muted)]" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[var(--color-text)]">{entry.name}</p>
        <p className={`text-xs ${entry.status === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-text-secondary)]"}`}>
          {entry.status === "error" && entry.error
            ? fileErrorLabel(t, entry.error)
            : entry.status === "done"
              ? t("booking_import_status_done", { count: entry.bookingCount })
              : t(`booking_import_status_${entry.status}`)}
        </p>
        {entry.status === "done" && entry.warnings.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-warning)]">
            {entry.warnings.map((code) => <li key={code}>{warningLabel(t, code)}</li>)}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {entry.status === "error" && (
          <button
            type="button"
            onClick={onRetry}
            aria-label={t("booking_import_retry_file", { name: entry.name })}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]"
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span>{t("booking_import_retry")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("booking_import_remove_file", { name: entry.name })}
          className="inline-flex size-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
