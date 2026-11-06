"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { CalendarDays, CheckCircle2, Circle, Compass, ImageOff, ImagePlus, MapPin, Share2, Users } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { TripCover } from "@/components/TripCover";
import { tripSectionHref } from "@/components/TripSectionNav";
import { isPlaceholderCity } from "@/lib/day-genius/context";
import { dayUrlParam, isTripUndated } from "@/lib/trip-undated";
import { TRIP_COVER_ACCEPT } from "@/lib/trip-cover";
import type { TripPlan } from "@/lib/types";

const TABS = ["summary", "packing", "shopping", "tools", "memories"] as const;
export type OverviewTab = (typeof TABS)[number];

type CoverResult = Promise<{ error?: string }>;

/** Cover controls for the owner and editors. */
export type TripCoverEditor = {
  onChange: (file: File) => CoverResult;
  onRemove: () => CoverResult;
  /** Shown disabled with the reason: a draft has no saved trip yet; offline cannot upload. */
  blocked?: "draft" | "offline";
};

type TripOverviewProps = {
  trip: TripPlan;
  /** Invitees cannot share someone else's trip. */
  canShare: boolean;
  onEditContext: () => void;
  onShare: () => void;
  /** Opens [Fijar fechas] for an undated trip; omitted for those who cannot edit the trip. */
  onSetDates?: () => void;
  /** Change/remove the cover; omitted for viewers. */
  coverEditor?: TripCoverEditor;
  // Blocks TripView already renders; this screen only places them in its tabs.
  budget: ReactNode;
  packing: ReactNode;
  shopping: ReactNode;
  tools: ReactNode;
  /** Viaje › Recuerdos, only for a trip that has ended; the tab is hidden without it. */
  memories?: ReactNode;
  /** Schedule tips for the summary when Tachi cannot show them (guests). */
  tips?: ReactNode;
  /** Controlled tab, so Tachi can open the packing list; uncontrolled when omitted. */
  tab?: OverviewTab;
  onTabChange?: (tab: OverviewTab) => void;
};

/** The trip section: summary and preparation, packing, shopping and travel tools as tabs. */
export function TripOverview({ trip, canShare, onEditContext, onShare, onSetDates, coverEditor, budget, packing, shopping, tools, memories, tips, tab: controlledTab, onTabChange }: TripOverviewProps) {
  const { t } = useI18n();
  const [ownTab, setOwnTab] = useState<OverviewTab>("summary");
  const tabs: readonly OverviewTab[] = memories ? TABS : TABS.filter((key) => key !== "memories");
  const requested = controlledTab ?? ownTab;
  const tab = tabs.includes(requested) ? requested : "summary";
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
    memories: t("trip_overview_tab_memories"),
  };

  const selectByKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === "Home" ? tabs[0]
      : event.key === "End" ? tabs[tabs.length - 1]
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
        {tabs.map((key) => (
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
            <TripSummary trip={trip} canShare={canShare} onEditContext={onEditContext} onShare={onShare} onSetDates={onSetDates} coverEditor={coverEditor} />
            <PreparationChecklist trip={trip} />
            {budget}
            {tips}
          </>
        )}
        {tab === "packing" && packing}
        {tab === "shopping" && shopping}
        {tab === "tools" && tools}
        {tab === "memories" && memories}
      </div>
    </div>
  );
}

function TripSummary({ trip, canShare, onEditContext, onShare, onSetDates, coverEditor }: Pick<TripOverviewProps, "trip" | "canShare" | "onEditContext" | "onShare" | "onSetDates" | "coverEditor">) {
  const { t, lang } = useI18n();
  const locale = lang === "es" ? es : enUS;
  const formatDate = (date: string) => format(parseISO(date), "d MMM yyyy", { locale });

  const undated = isTripUndated(trip);
  const dates = trip.startDate && !undated
    ? [trip.startDate, trip.endDate].filter(Boolean).map((d) => formatDate(d as string)).join(" – ")
    : t("trip_overview_no_dates", { count: trip.days.length });
  const cities = [...new Set(trip.days.map((d) => d.city.trim()).filter((c) => !isPlaceholderCity(c)))];
  const travelers = trip.travelContext?.travelerCount;

  return (
    <section className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
      {/* The uploaded cover, or the default placeholder until the curated photo set exists. */}
      <TripCover path={trip.coverPath} className="h-32 md:h-40" />
      <div className="p-5 space-y-4">
        {coverEditor && <CoverControls hasCover={Boolean(trip.coverPath)} editor={coverEditor} />}
        <h2 className="text-xl font-black text-[var(--color-text)]">{trip.name}</h2>
        <ul className="space-y-2 text-sm font-medium text-[var(--color-text-secondary)]">
          <li className="flex items-center gap-2">
            <CalendarDays size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            <span>{dates}</span>
            {undated && onSetDates && (
              <button
                type="button"
                onClick={onSetDates}
                className="min-h-11 ml-auto inline-flex items-center rounded-xl bg-[var(--color-primary-subtle)] px-3 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 transition-colors"
              >
                {t("trip_set_dates")}
              </button>
            )}
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
      </div>
    </section>
  );
}

const COVER_ERROR_KEYS = {
  draft: "trip_cover_draft",
  offline: "trip_cover_offline",
  forbidden: "trip_cover_error_forbidden",
  type: "trip_cover_error_type",
  size: "trip_cover_error_size",
  upload: "trip_cover_error_upload",
  unavailable: "trip_cover_error_unavailable",
} as const;

/** [Cambiar portada] opens an image picker; [Quitar portada] goes back to the placeholder. */
function CoverControls({ hasCover, editor }: { hasCover: boolean; editor: TripCoverEditor }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || Boolean(editor.blocked);

  const run = async (action: "change" | "remove", task: () => CoverResult) => {
    setBusy(true);
    setError(null);
    let failure: string | undefined;
    try {
      failure = (await task()).error;
    } catch {
      failure = "upload";
    }
    setBusy(false);
    if (!failure) return;
    if (action === "remove" && failure === "upload") setError(t("trip_cover_error_remove"));
    else setError(t(COVER_ERROR_KEYS[failure as keyof typeof COVER_ERROR_KEYS] ?? "trip_cover_error_upload"));
  };

  const buttonClass =
    "min-h-11 inline-flex items-center gap-2 rounded-xl bg-[var(--color-surface-subtle)] px-4 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-60 disabled:pointer-events-none";

  return (
    <div className="space-y-2" aria-busy={busy}>
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={TRIP_COVER_ACCEPT}
          aria-label={t("trip_cover_change")}
          tabIndex={-1}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file again still fires a change.
            event.target.value = "";
            if (file) void run("change", () => editor.onChange(file));
          }}
        />
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className={buttonClass}>
          <ImagePlus size={16} aria-hidden="true" />
          {t("trip_cover_change")}
        </button>
        {hasCover && (
          <button type="button" disabled={disabled} onClick={() => void run("remove", editor.onRemove)} className={buttonClass}>
            <ImageOff size={16} aria-hidden="true" />
            {t("trip_cover_remove")}
          </button>
        )}
      </div>
      {editor.blocked && <p className="text-xs text-[var(--color-text-muted)]">{t(COVER_ERROR_KEYS[editor.blocked])}</p>}
      {error && (
        <p role="alert" className="text-xs font-semibold text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Derived from the trip as it is: bookings still to make and days with nothing planned. */
function PreparationChecklist({ trip }: { trip: TripPlan }) {
  const { t, lang } = useI18n();
  const locale = lang === "es" ? es : enUS;
  const pendingReservations = trip.criticalReservations.filter((r) => r.status === "pending").length;
  const emptyDays = trip.days.filter((d) => d.activities.length === 0);
  const headingId = useId();
  const undated = isTripUndated(trip);

  // An undated trip's day dates are placeholders: its days go by number.
  const dayName = (dayId: string, date: string, city: string) => {
    const day = undated
      ? t("trip_view_day_number", { number: trip.days.findIndex((d) => d.id === dayId) + 1 })
      : format(parseISO(date), "EEE d MMM", { locale });
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
            <ChecklistLink key={d.id} href={tripSectionHref(trip.id, "itinerary", dayUrlParam(trip, d))}>
              {t("trip_overview_day_empty", { day: dayName(d.id, d.date, d.city) })}
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
