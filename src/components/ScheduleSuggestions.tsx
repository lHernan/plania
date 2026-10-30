"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import type { OptimizationSuggestion } from "@/lib/types";

/**
 * Schedule notes for the day (tight transfers, overlaps), folded behind one count line so a
 * plan the traveler wants to keep as it is does not fill the panel.
 */
export function ScheduleSuggestions({
  suggestions,
  onApplyFix,
}: {
  suggestions: OptimizationSuggestion[];
  /** Applies a note's one-tap fix; without it the fix button is hidden (e.g. read-only invitees). */
  onApplyFix?: (fix: NonNullable<OptimizationSuggestion["fix"]>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (suggestions.length === 0) return null;

  const label = suggestions.length === 1
    ? t("schedule_notes_one")
    : t("schedule_notes_other", { count: suggestions.length });

  return (
    <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center justify-between gap-2 px-1 py-1 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <span className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--color-accent-ai)]" aria-hidden />
          {label}
        </span>
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>
      {open && suggestions.map((s) => (
        <div key={s.id} className="flex gap-3 p-3 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
          <div className="size-7 rounded-lg bg-[var(--color-accent-ai)]/10 flex items-center justify-center text-[var(--color-accent-ai)] shrink-0">
            <Sparkles size={14} />
          </div>
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs font-bold text-[var(--color-text)] tracking-tight">{s.title}</p>
            <p className="text-[10px] text-[var(--color-text-muted)] font-medium leading-relaxed">{s.reason}</p>
            {s.fix && onApplyFix && (
              <button
                type="button"
                onClick={() => onApplyFix(s.fix!)}
                className="mt-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-[var(--color-primary-hover)] transition-colors"
              >
                {t("schedule_note_apply_time", { time: s.fix.time })}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
