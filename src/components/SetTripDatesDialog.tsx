"use client";

import { useId, useState, type FormEvent } from "react";
import { LoaderCircle, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { consecutiveDates } from "@/lib/trip-undated";

type SetTripDatesDialogProps = {
  /** Days of the trip: they get consecutive dates from the start, in order. */
  dayCount: number;
  onSave: (startDate: string) => Promise<{ error?: string }>;
  onClose: () => void;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** [Fijar fechas] of an undated trip: the start is chosen, the end follows from the number of days. */
export function SetTripDatesDialog({ dayCount, onSave, onClose }: SetTripDatesDialogProps) {
  const { t } = useI18n();
  const id = useId();
  const [start, setStart] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validStart = DATE_RE.test(start);
  const end = validStart ? consecutiveDates(start, Math.max(1, dayCount)).at(-1) ?? start : "";

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!validStart || saving) return;
    setSaving(true);
    setError(null);
    const result = await onSave(start);
    setSaving(false);
    if (result.error) {
      setError(result.error === "offline" ? t("trip_set_dates_offline") : t("trip_set_dates_failed"));
      return;
    }
    onClose();
  };

  const inputClass =
    "mt-1 min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-semibold text-[var(--color-text)]";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[var(--color-text)]/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="w-full max-w-md rounded-t-3xl bg-[var(--color-surface)] p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id={`${id}-title`} className="text-lg font-black text-[var(--color-text)]">
              {t("trip_set_dates_title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t("trip_set_dates_hint", { count: dayCount })}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={save} className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor={`${id}-start`} className="text-xs font-bold text-[var(--color-text-secondary)]">
              {t("trip_set_dates_start")}
              <input
                id={`${id}-start`}
                type="date"
                required
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className={inputClass}
              />
            </label>
            <label htmlFor={`${id}-end`} className="text-xs font-bold text-[var(--color-text-secondary)]">
              {t("trip_set_dates_end")}
              <input id={`${id}-end`} type="date" readOnly value={end} className={`${inputClass} bg-[var(--color-surface-subtle)]`} />
            </label>
          </div>

          {error && <p role="alert" className="text-sm font-bold text-[var(--color-danger)]">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl px-4 text-sm font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={!validStart || saving}
              className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving && <LoaderCircle size={16} className="animate-spin" />}
              {t("trip_set_dates_confirm")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
