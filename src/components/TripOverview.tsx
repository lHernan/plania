"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { CalendarDays, CheckCircle2, Circle, Compass, MapPin, Share2, Users } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { tripSectionHref } from "@/components/TripSectionNav";
import { isPlaceholderCity } from "@/lib/day-genius/context";
import type { TripPlan } from "@/lib/types";

const TABS = ["summary", "packing", "shopping", "tools"] as const;
export type OverviewTab = (typeof TABS)[number];

type TripOverviewProps = {
  trip: TripPlan;
  /** Invitees cannot share someone else's trip. */
  canShare: boolean;
  onEditContext: () => void;
  onShare: () => void;
  // Blocks TripView already renders; this screen only places them in its tabs.
  budget: ReactNode;
  packing: ReactNode;
  shopping: ReactNode;
  tools: ReactNode;
  /** Schedule tips for the summary when Tachi cannot show them (guests). */
  tips?: ReactNode;
  /** Controlled tab, so Tachi can open the packing list; uncontrolled when omitted. */
  tab?: OverviewTab;
  onTabChange?: (tab: OverviewTab) => void;
};

/** The trip section: summary and preparation, packing, shopping and travel tools as tabs. */
export function TripOverview({ trip, canShare, onEditContext, onShare, budget, packing, shopping, tools, tips, tab: controlledTab, onTabChange }: TripOverviewProps) {
  const { t } = useI18n();
  const [ownTab, setOwnTab] = useState<OverviewTab>("summary");
  const tab = controlledTab ?? ownTab;
  const setTab = (next: OverviewTab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };
  const baseId = useId();
  const tabId = (key: OverviewTab) => `${baseId}-tab-${key}`;
  const panelId = (key: OverviewTab) => `${baseId}-panel-${key}`;

  const labels: Record<OverviewTab, string> = {
    summary: t("trip_overview_tab_summary"),
    packing: t("trip_overview_tab_packing"),
    shopping: t("trip_overview_tab_shopping"),
    tools: t("trip_overview_tab_tools"),
  };

  const selectByKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length]
      : event.key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length]
      : event.key === "Home" ? TABS[0]
      : event.key === "End" ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label={t("trip_overview_tabs_label")}
        className="flex gap-1 overflow-x-auto scrollbar-hide rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-1"
      >
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={tabId(key)}
            aria-selected={tab === key}
            aria-controls={panelId(key)}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={selectByKey}
            className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-4 text-xs font-bold transition-colors ${
              tab === key
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
            }`}
          >
            {labels[key]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="space-y-6">
        {tab === "summary" && (
          <>
            <TripSummary trip={trip} canShare={canShare} onEditContext={onEditContext} onShare={onShare} />
            <PreparationChecklist trip={trip} />
            {budget}
            {tips}
          </>
        )}
        {tab === "packing" && packing}
        {tab === "shopping" && shopping}
        {tab === "tools" && tools}
      </div>
    </div>
  );
}

function TripSummary({ trip, canShare, onEditContext, onShare }: Pick<TripOverviewProps, "trip" | "canShare" | "onEditContext" | "onShare">) {
  const { t, lang } = useI18n();
  const locale = lang === "es" ? es : enUS;
  const formatDate = (date: string) => format(parseISO(date), "d MMM yyyy", { locale });

  const dates = trip.startDate
    ? [trip.startDate, trip.endDate].filter(Boolean).map((d) => formatDate(d as string)).join(" – ")
    : t("trip_overview_no_dates", { count: trip.days.length });
  const cities = [...new Set(trip.days.map((d) => d.city.trim()).filter((c) => !isPlaceholderCity(c)))];
  const travelers = trip.travelContext?.travelerCount;

  return (
    <section className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-4">
      <h2 className="text-xl font-black text-[var(--color-text)]">{trip.name}</h2>
      <ul className="space-y-2 text-sm font-medium text-[var(--color-text-secondary)]">
        <li className="flex items-center gap-2">
          <CalendarDays size={16} className="shrink-0 text-[var(--color-text-muted)]" />
          <span>{dates}</span>
        </li>
        {cities.length > 0 && (
          <li className="flex items-center gap-2">
            <MapPin size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            <span>{cities.join(" · ")}</span>
          </li>
        )}
        {travelers ? (
          <li className="flex items-center gap-2">
            <Users size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            <span>{t("trip_overview_travelers", { count: travelers })}</span>
          </li>
        ) : null}
      </ul>
      {!travelers && <p className="text-xs text-[var(--color-text-muted)]">{t("trip_overview_context_empty")}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEditContext}
          className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[var(--color-surface-subtle)] px-4 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)] transition-colors"
        >
          <Compass size={16} />
          {t("trip_overview_edit_context")}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={onShare}
            className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary-subtle)] px-4 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 transition-colors"
          >
            <Share2 size={16} />
            {t("trip_view_share")}
          </button>
        )}
      </div>
    </section>
  );
}

/** Derived from the trip as it is: bookings still to make and days with nothing planned. */
function PreparationChecklist({ trip }: { trip: TripPlan }) {
  const { t, lang } = useI18n();
  const locale = lang === "es" ? es : enUS;
  const pendingReservations = trip.criticalReservations.filter((r) => r.status === "pending").length;
  const emptyDays = trip.days.filter((d) => d.activities.length === 0);
  const headingId = useId();

  const dayName = (date: string, city: string) => {
    const day = format(parseISO(date), "EEE d MMM", { locale });
    return isPlaceholderCity(city) ? day : `${day} · ${city}`;
  };

  return (
    <section className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-3">
      <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {t("trip_overview_preparation")}
      </h3>
      <ul aria-labelledby={headingId} className="space-y-1 text-sm font-medium">
        {pendingReservations > 0 ? (
          <ChecklistLink href={tripSectionHref(trip.id, "wallet")}>
            {t("trip_overview_reservations_pending", { count: pendingReservations })}
          </ChecklistLink>
        ) : (
          <ChecklistDone>{t("trip_overview_reservations_done")}</ChecklistDone>
        )}
        {emptyDays.length > 0 ? (
          emptyDays.map((d) => (
            <ChecklistLink key={d.id} href={tripSectionHref(trip.id, "itinerary", d.date)}>
              {t("trip_overview_day_empty", { day: dayName(d.date, d.city) })}
            </ChecklistLink>
          ))
        ) : (
          <ChecklistDone>{t("trip_overview_days_done")}</ChecklistDone>
        )}
      </ul>
    </section>
  );
}

function ChecklistLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="min-h-11 flex items-center gap-2 rounded-xl px-2 text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] transition-colors"
      >
        <Circle size={16} aria-hidden className="shrink-0 text-[var(--color-warning)]" />
        <span>{children}</span>
      </Link>
    </li>
  );
}

function ChecklistDone({ children }: { children: ReactNode }) {
  return (
    <li className="min-h-11 flex items-center gap-2 px-2 text-[var(--color-text-secondary)]">
      <CheckCircle2 size={16} aria-hidden className="shrink-0 text-[var(--color-success)]" />
      <span>{children}</span>
    </li>
  );
}
