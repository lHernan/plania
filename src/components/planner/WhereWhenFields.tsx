"use client";

import { useId } from "react";
import { format } from "date-fns";
import { MapPin } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MAX_PLANNER_DAYS, type PlannerForm } from "@/lib/planner/form";

export type WhereWhen = Pick<PlannerForm, "destinations" | "mode" | "startDate" | "endDate" | "dayCount">;

const inputClass =
  "w-full min-h-[48px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 text-base font-bold text-[var(--color-text)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-primary)]/30";
const labelClass = "text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-muted)]";

/** Where and when: destination(s) plus dates, or a number of days for trips without dates. */
export function WhereWhenFields({ value, onChange, showHint = false }: { value: WhereWhen; onChange: (patch: Partial<WhereWhen>) => void; showHint?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const today = format(new Date(), "yyyy-MM-dd");

  const modeButton = (mode: WhereWhen["mode"], label: string) => (
    <button
      type="button"
      aria-pressed={value.mode === mode}
      onClick={() => onChange({ mode })}
      className={`min-h-[44px] flex-1 rounded-xl px-3 text-xs font-black transition-colors ${
        value.mode === mode ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-dest`} className={labelClass}>{t("planner_destination_label")}</label>
        <div className="relative">
          <MapPin size={18} aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            id={`${id}-dest`}
            type="text"
            value={value.destinations}
            maxLength={200}
            autoComplete="off"
            placeholder={t("planner_destination_placeholder")}
            onChange={(e) => onChange({ destinations: e.target.value })}
            className={`${inputClass} pl-11`}
          />
        </div>
        {showHint && <p className="text-xs text-[var(--color-text-muted)]">{t("planner_destination_hint")}</p>}
      </div>

      <div className="flex gap-1 rounded-2xl bg-[var(--color-surface-subtle)] p-1">
        {modeButton("dates", t("planner_mode_dates"))}
        {modeButton("days", t("planner_mode_days"))}
      </div>

      {value.mode === "dates" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor={`${id}-start`} className={labelClass}>{t("landing_start_date")}</label>
            <input
              id={`${id}-start`}
              type="date"
              min={today}
              value={value.startDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-end`} className={labelClass}>{t("landing_end_date")}</label>
            <input
              id={`${id}-end`}
              type="date"
              min={value.startDate || today}
              value={value.endDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${id}-days`} className={labelClass}>{t("planner_day_count_label")}</label>
          <input
            id={`${id}-days`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PLANNER_DAYS}
            value={value.dayCount}
            onChange={(e) => onChange({ dayCount: Number(e.target.value) })}
            className={inputClass}
          />
          {showHint && <p className="text-xs text-[var(--color-text-muted)]">{t("planner_days_start_today")}</p>}
        </div>
      )}
    </div>
  );
}
