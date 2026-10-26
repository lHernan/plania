"use client";

import { Sparkles, Ticket } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import type { Activity } from "@/lib/types";

/**
 * Distinguishes confirmed bookings (imported from documents) from accepted AI suggestions.
 * Icon + text, never color alone. Manual activities render nothing.
 */
export function OriginBadge({ activity, className = "" }: { activity: Pick<Activity, "origin" | "booking">; className?: string }) {
  const { t } = useI18n();

  if (activity.origin === "booking") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary-subtle)] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-[var(--color-primary)] ${className}`}
        title={t("origin_booking_hint")}
      >
        <Ticket size={10} aria-hidden="true" />
        <span>{t("origin_booking")}</span>
        {activity.booking?.reference && (
          <span className="font-mono normal-case tracking-normal text-[var(--color-primary)]/80">{activity.booking.reference}</span>
        )}
      </span>
    );
  }

  if (activity.origin === "suggested") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-accent-ai)]/50 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-[var(--color-accent-ai)] ${className}`}
        title={t("origin_suggested_hint")}
      >
        <Sparkles size={10} aria-hidden="true" />
        <span>{t("origin_suggested")}</span>
      </span>
    );
  }

  return null;
}
