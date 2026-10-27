"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CalendarArrowUp,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CircleSlash,
  HelpCircle,
  Snowflake,
  Sparkles,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { OriginBadge } from "@/components/OriginBadge";
import { useGeocodeCache } from "@/hooks/use-geocode-cache";
import { supabase } from "@/lib/supabase";
import { getCurrentTripDateTime } from "@/lib/travel-context";
import { buildGeniusContext, tripTimeZone, type Coords, type GeniusContext, type GeniusUnavailableReason } from "@/lib/day-genius/context";
import { geniusConflicts, type GeniusChange, type GeniusRejection } from "@/lib/day-genius/validate";
import { planToOps } from "@/lib/day-genius/apply";
import type { DayWeather, WeatherCondition } from "@/lib/weather/day-forecast";
import { useItineraryStore } from "@/store/use-itinerary-store";

const WEATHER_ICONS: Record<WeatherCondition, LucideIcon> = {
  clear: Sun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: Snowflake,
  storm: CloudLightning,
  unknown: HelpCircle,
};

/** The AI may think for a while, but never keep the traveler waiting forever. */
export const GENIUS_TIMEOUT_MS = 90_000;
/** Distances are optional: plan without them rather than wait on the geocoder. */
export const GEOCODE_TIMEOUT_MS = 10_000;

const settleWithin = (promise: Promise<unknown>, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.catch(() => undefined).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });

type GeniusResult = { summary: string; changes: GeniusChange[]; rejected: GeniusRejection[]; weather: DayWeather | null };

type Status =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: GeniusUnavailableReason | "offline" }
  | { kind: "failed" }
  | { kind: "ready"; context: GeniusContext; result: GeniusResult };

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

export function DayGeniusModal({
  dayId,
  onClose,
  onToast,
}: {
  dayId: string;
  onClose: () => void;
  onToast: (msg: string, type?: "success" | "error") => void;
}) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  const applyDayPlan = useItineraryStore((s) => s.applyDayPlan);
  const { getCoords, geocodeActivities } = useGeocodeCache();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // The parent passes a new onClose on every render; reading it from a ref keeps run()
  // stable, so a parent re-render never restarts the genie.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Only the latest run may update the modal (a retry or closing supersedes it).
  const runIdRef = useRef(0);
  useEffect(() => () => {
    runIdRef.current += 1;
  }, []);

  const run = useCallback(async () => {
    const runId = ++runIdRef.current;
    const isCurrent = () => runId === runIdRef.current;
    setStatus({ kind: "loading" });
    setApplyError(null);
    const trip = useItineraryStore.getState().activeTrip;
    const day = trip?.days.find((d) => d.id === dayId);
    if (!trip || !day) return onCloseRef.current();
    if (typeof navigator !== "undefined" && !navigator.onLine) return setStatus({ kind: "unavailable", reason: "offline" });

    const zone = tripTimeZone(trip, Intl.DateTimeFormat().resolvedOptions().timeZone);
    const now = getCurrentTripDateTime(new Date(), zone);
    // Cheap check first: no geocoding or AI call when there is nothing to do.
    const precheck = buildGeniusContext({ days: trip.days, dayId, now });
    if (!precheck.ok) return setStatus({ kind: "unavailable", reason: precheck.reason });

    await settleWithin(geocodeActivities(day.activities, day.city), GEOCODE_TIMEOUT_MS);
    if (!isCurrent()) return;
    const coords: Record<string, Coords> = {};
    for (const activity of day.activities) {
      const found = activity.location ? getCoords(activity.location) : null;
      if (found) coords[activity.id] = found;
    }
    const built = buildGeniusContext({ days: trip.days, dayId, now, coords });
    if (!built.ok) return setStatus({ kind: "unavailable", reason: built.reason });
    // Where the traveler ends the day (a flight's place is where it departs from).
    const weatherCoords = [...day.activities]
      .filter((a) => coords[a.id])
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"))
      .map((a) => coords[a.id])
      .at(-1);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENIUS_TIMEOUT_MS);
    try {
      const response = await fetch("/api/day-genius", {
        method: "POST",
        headers: await authHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          context: built.context,
          today: now.date,
          lang,
          ...(weatherCoords ? { weatherCoords } : {}),
        }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const result = (await response.json()) as GeniusResult;
      if (!isCurrent()) return;
      setAccepted(new Set(result.changes.filter((c) => c.kind !== "unplaced").map((c) => c.key)));
      setStatus({ kind: "ready", context: built.context, result });
    } catch {
      if (isCurrent()) setStatus({ kind: "failed" });
    } finally {
      clearTimeout(timer);
    }
  }, [dayId, geocodeActivities, getCoords, lang]);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !applying) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, onClose]);

  const conflicts = useMemo(
    () => (status.kind === "ready" ? geniusConflicts(status.context, status.result.changes, accepted) : new Set<string>()),
    [accepted, status],
  );
  const applicable = status.kind === "ready" ? status.result.changes.filter((c) => c.kind !== "unplaced" && accepted.has(c.key)) : [];

  const toggle = (key: string) =>
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = async () => {
    if (status.kind !== "ready" || applicable.length === 0 || conflicts.size > 0) return;
    const trip = useItineraryStore.getState().activeTrip;
    if (!trip) return;
    setApplying(true);
    setApplyError(null);
    const result = await applyDayPlan(planToOps({ days: trip.days, dayId, changes: status.result.changes, accepted }));
    setApplying(false);
    if (result.ok) {
      onToast(t("day_genius_applied"), "success");
      onClose();
    } else {
      setApplyError(t("day_genius_apply_failed", { error: result.error }));
    }
  };

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const titleOf = (activityId: string) =>
    status.kind === "ready" ? status.context.movable.find((m) => m.id === activityId)?.title ?? "" : "";

  const freeDay = status.kind === "ready" && status.context.movable.length === 0;
  const subtitle =
    status.kind === "ready"
      ? status.context.now
        ? t(freeDay ? "day_genius_subtitle_free_today" : "day_genius_subtitle_today", { time: status.context.now })
        : t(freeDay ? "day_genius_subtitle_free_future" : "day_genius_subtitle_future", { date: formatDate(status.context.date) })
      : null;
  const ongoing = status.kind === "ready" ? status.context.fixed.find((f) => f.kind === "ongoing") : undefined;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-6" onClick={() => !applying && onClose()}>
      <motion.div
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm"
        aria-hidden="true"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reducedMotion ? false : { y: "100%" }}
        animate={{ y: 0 }}
        transition={reducedMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-2xl md:max-h-[85dvh] md:rounded-2xl"
      >
        <header className="flex items-start gap-3 border-b border-[var(--color-border)] px-5 pb-4 pt-5 md:px-8">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-ai)]/10 text-[var(--color-accent-ai)]">
            <Sparkles size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-black text-[var(--color-text)]">{t("day_genius")}</h2>
            {subtitle && <p className="text-xs text-[var(--color-text-secondary)]">{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={applying}
            aria-label={t("day_genius_close")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-8" aria-live="polite">
          {status.kind === "loading" && (
            <div className="flex items-center gap-3 py-10 text-sm text-[var(--color-text-secondary)]" role="status">
              <div className="size-5 animate-spin rounded-full border-2 border-[var(--color-accent-ai)]/20 border-t-[var(--color-accent-ai)]" aria-hidden="true" />
              {t("day_genius_loading")}
            </div>
          )}

          {status.kind === "unavailable" && (
            <p className="py-8 text-sm text-[var(--color-text-secondary)]">
              {status.reason === "offline" ? t("day_genius_offline") : t(`day_genius_unavailable_${status.reason}`)}
            </p>
          )}

          {status.kind === "failed" && (
            <div className="space-y-3 py-6">
              <p className="text-sm text-[var(--color-danger)]" role="alert">{t("day_genius_failed")}</p>
              <button type="button" onClick={() => void run()} className="rounded-xl bg-[var(--color-surface-subtle)] px-4 py-2 text-xs font-bold">
                {t("day_genius_retry")}
              </button>
            </div>
          )}

          {status.kind === "ready" && (
            <>
              <section aria-label={t("day_genius_weather_title")}>
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)]">{t("day_genius_weather_title")}</h3>
                {status.result.weather && status.result.weather.hours.length > 0 ? (
                  <ol className="flex gap-2 overflow-x-auto pb-1">
                    {status.result.weather.hours.map((hour) => {
                      const Icon = WEATHER_ICONS[hour.condition];
                      const wet = (hour.precipProbability ?? 0) >= 60 || hour.condition === "rain" || hour.condition === "storm";
                      return (
                        <li
                          key={hour.time}
                          className={`flex min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] ${wet ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]" : "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]"}`}
                        >
                          <span className="font-bold tabular-nums">{hour.time}</span>
                          <Icon size={16} aria-label={t(`weather_condition_${hour.condition}`)} />
                          {hour.precipProbability !== null && <span className="tabular-nums">{t("day_genius_rain_chance", { pct: hour.precipProbability })}</span>}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-xs text-[var(--color-text-secondary)]">{t("day_genius_weather_unavailable")}</p>
                )}
              </section>

              {(status.result.summary || ongoing) && (
                <div className="space-y-1 rounded-xl bg-[var(--color-accent-ai)]/5 p-4 text-sm text-[var(--color-text)]">
                  {status.result.summary && <p>{status.result.summary}</p>}
                  {ongoing && <p className="text-xs text-[var(--color-text-secondary)]">{t("day_genius_ongoing", { title: ongoing.title })}</p>}
                </div>
              )}

              <section>
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)]">{t("day_genius_changes")}</h3>
                {status.result.changes.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">{t("day_genius_no_changes")}</p>
                ) : (
                  <ul className="space-y-2">
                    {status.result.changes.map((change) => (
                      <ChangeRow
                        key={change.key}
                        change={change}
                        checked={accepted.has(change.key)}
                        conflict={conflicts.has(change.key)}
                        onToggle={() => toggle(change.key)}
                        titleOf={titleOf}
                        formatDate={formatDate}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <div className="space-y-1 text-[11px] text-[var(--color-text-muted)]">
                {status.result.rejected.length > 0 && <p>{t("day_genius_rejected", { count: status.result.rejected.length })}</p>}
                {status.context.travel.length > 0 && <p>{t("day_genius_travel_note")}</p>}
              </div>
            </>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-[var(--color-border)] px-5 py-4 md:px-8">
          {applyError && <p className="text-xs text-[var(--color-danger)]" role="alert">{applyError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={applying} className="rounded-xl px-4 py-2 text-xs font-bold text-[var(--color-text-secondary)]">
              {t("day_genius_cancel")}
            </button>
            {status.kind === "ready" && applicable.length > 0 && (
              <button
                type="button"
                onClick={() => void apply()}
                disabled={applying || conflicts.size > 0}
                className="rounded-xl bg-[var(--color-accent-ai)] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {t("day_genius_apply", { count: applicable.length })}
              </button>
            )}
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

function ChangeRow({
  change,
  checked,
  conflict,
  onToggle,
  titleOf,
  formatDate,
}: {
  change: GeniusChange;
  checked: boolean;
  conflict: boolean;
  onToggle: () => void;
  titleOf: (activityId: string) => string;
  formatDate: (date: string) => string;
}) {
  const { t } = useI18n();
  const reasonId = useId();

  let title: string;
  let detail: ReactNode;
  if (change.kind === "reschedule") {
    title = change.title;
    detail = (
      <span className="inline-flex items-center gap-1 tabular-nums">
        {change.from.time} <ArrowRight size={12} aria-hidden="true" /> {change.to.time}
        {change.to.durationMin !== change.from.durationMin && <span className="text-[var(--color-text-muted)]">· {change.to.durationMin} min</span>}
      </span>
    );
  } else if (change.kind === "move_day") {
    title = change.title;
    detail = (
      <span className="inline-flex items-center gap-1">
        <CalendarArrowUp size={12} aria-hidden="true" /> {t("day_genius_move", { date: formatDate(change.toDate), time: change.toTime })}
      </span>
    );
  } else if (change.kind === "add") {
    title = change.suggestion.title;
    detail = (
      <span className="flex flex-col gap-0.5">
        <span className="tabular-nums">{t("day_genius_add", { time: change.suggestion.time, duration: change.suggestion.durationMin })}</span>
        {change.replacesId && titleOf(change.replacesId) && <span>{t("day_genius_replaces", { title: titleOf(change.replacesId) })}</span>}
        {change.suggestion.notes && <span className="text-[var(--color-text-muted)]">{change.suggestion.notes}</span>}
      </span>
    );
  } else {
    title = change.title;
    detail = (
      <span className="inline-flex items-center gap-1">
        <CircleSlash size={12} aria-hidden="true" /> {t("day_genius_unplaced")}
      </span>
    );
  }

  const body = (
    <span className="min-w-0 flex-1 space-y-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-[var(--color-text)]">{title}</span>
        {change.kind === "add" && <OriginBadge activity={{ origin: "suggested" }} />}
      </span>
      <span className="block text-xs text-[var(--color-text-secondary)]">{detail}</span>
      {change.reason && <span id={reasonId} className="block text-xs text-[var(--color-text-muted)]">{change.reason}</span>}
      {conflict && <span className="block text-xs font-bold text-[var(--color-danger)]">{t("day_genius_conflict")}</span>}
    </span>
  );

  if (change.kind === "unplaced") {
    return <li className="flex gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-3">{body}</li>;
  }
  return (
    <li>
      <label
        className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${conflict ? "border-[var(--color-danger)]" : checked ? "border-[var(--color-accent-ai)]/40 bg-[var(--color-accent-ai)]/5" : "border-[var(--color-border)]"}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-describedby={change.reason ? reasonId : undefined}
          className="mt-1 size-4 shrink-0 accent-[var(--color-accent-ai)]"
        />
        {body}
      </label>
    </li>
  );
}
