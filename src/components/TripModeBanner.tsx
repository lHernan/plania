"use client";

import Link from "next/link";
import { CalendarClock, Flag } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

type Props =
  | { mode: "planning"; daysUntilStart: number | null; preparationHref: string }
  | { mode: "memory"; crossedOff: number; total: number };

/** Slim banner for a trip still being planned or already over. It never blocks editing. */
export function TripModeBanner(props: Props) {
  const { t } = useI18n();
  const title = props.mode === "planning" ? t("trip_mode_planning") : t("trip_mode_memory");

  let detail: string;
  if (props.mode === "memory") {
    detail = t("trip_mode_crossed_off", { count: props.crossedOff, total: props.total });
  } else if (props.daysUntilStart === null) {
    detail = t("trip_mode_no_dates");
  } else {
    detail = props.daysUntilStart === 1
      ? t("trip_mode_starts_in_one")
      : t("trip_mode_starts_in_other", { count: props.daysUntilStart });
  }

  return (
    <section
      aria-label={title}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-2.5"
    >
      {props.mode === "planning" ? (
        <CalendarClock size={16} className="shrink-0 text-[var(--color-primary)]" />
      ) : (
        <Flag size={16} className="shrink-0 text-[var(--color-primary)]" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text)]">{title}</p>
        <p className="text-xs font-bold text-[var(--color-text-secondary)]">{detail}</p>
      </div>
      <Link
        href={props.mode === "planning" ? props.preparationHref : "/trips"}
        className="shrink-0 rounded-xl bg-[var(--color-primary-subtle)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-primary)]"
      >
        {props.mode === "planning" ? t("trip_mode_prepare") : t("trip_mode_plan_next")}
      </Link>
    </section>
  );
}
