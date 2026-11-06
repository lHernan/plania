"use client";

import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useTripSummary } from "@/hooks/use-trip-summary";

const chip =
  "min-h-11 inline-flex items-center gap-2 rounded-xl bg-[var(--color-surface-subtle)] px-4 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-60 disabled:pointer-events-none";

/** Tachi panel for "Resume mi viaje": the summary with [Copiar] and [Volver a generar]. */
export function TripSummaryPanel({ tripId }: { tripId: string }) {
  const { t, lang } = useI18n();
  const { status, summary, regenerate } = useTripSummary(tripId, lang);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const again = () => {
    setCopied(false);
    regenerate();
  };

  return (
    <div className="space-y-3" aria-busy={status === "loading"}>
      {status === "loading" && (
        <p role="status" className="text-sm text-[var(--color-text-secondary)]">{t("trip_summary_loading")}</p>
      )}
      {status === "offline" && (
        <p role="alert" className="text-sm font-semibold text-[var(--color-text-secondary)]">{t("trip_summary_offline")}</p>
      )}
      {status === "quota_exceeded" && (
        <p role="alert" className="text-sm font-semibold text-[var(--color-danger)]">{t("ai_quota_exceeded")}</p>
      )}
      {status === "error" && (
        <p role="alert" className="text-sm font-semibold text-[var(--color-danger)]">{t("trip_summary_error")}</p>
      )}
      {status === "done" && (
        <div className="space-y-2 rounded-xl bg-[var(--color-surface-subtle)] p-4 text-sm leading-relaxed text-[var(--color-text)]">
          {summary.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index} className="whitespace-pre-line">{paragraph}</p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "done" && (
          <button type="button" onClick={() => void copy()} className={chip}>
            <Copy size={16} aria-hidden="true" />
            {t("trip_summary_copy")}
          </button>
        )}
        {status !== "loading" && (
          <button type="button" onClick={again} className={chip}>
            <RefreshCw size={16} aria-hidden="true" />
            {t("trip_summary_regenerate")}
          </button>
        )}
      </div>
      {copied && <p role="status" className="text-xs font-bold text-[var(--color-success)]">{t("trip_summary_copied")}</p>}
    </div>
  );
}
