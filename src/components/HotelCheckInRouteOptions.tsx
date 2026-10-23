"use client";

import { useState, type FormEvent } from "react";
import { Car, Footprints, MapPin, Navigation, Train } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import type { HotelArrivalStop } from "@/lib/arrival-assistant";
import { buildGoogleMapsDirectionsUrl, type GoogleMapsTravelMode } from "@/lib/google-maps-links";

const MAP_MODES: Array<{
  mode: GoogleMapsTravelMode;
  titleKey: string;
  detailKey: string;
  icon: typeof Footprints;
}> = [
  { mode: "walking", titleKey: "arrival_quick_walk", detailKey: "arrival_quick_walk_hint", icon: Footprints },
  { mode: "transit", titleKey: "arrival_quick_transit", detailKey: "arrival_quick_transit_hint", icon: Train },
  { mode: "driving", titleKey: "arrival_quick_rides", detailKey: "arrival_quick_rides_hint", icon: Car },
];

type OriginOverride = { value: string; source: "manual" | "device" };

function formatLocalDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function HotelCheckInRouteOptions({ stop, isCurrentDay }: { stop: HotelArrivalStop; isCurrentDay: boolean }) {
  const { t } = useI18n();
  const [originOverride, setOriginOverride] = useState<OriginOverride | null>(null);
  const [originDraft, setOriginDraft] = useState("");
  const [editingOrigin, setEditingOrigin] = useState(!stop.origin);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = originOverride?.value ?? stop.origin;
  const originSource = originOverride?.source ?? stop.originSource;

  const saveManualOrigin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = originDraft.trim();
    if (!value) {
      setError(t("hotel_route_origin_missing"));
      return;
    }
    setOriginOverride({ value, source: "manual" });
    setEditingOrigin(false);
    setError(null);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError(t("hotel_route_geolocation_denied"));
      return;
    }

    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setOriginOverride({ value: `${coords.latitude},${coords.longitude}`, source: "device" });
        setLocating(false);
        setEditingOrigin(false);
      },
      () => {
        setError(t("hotel_route_geolocation_denied"));
        setLocating(false);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  };

  const originSourceLabel = originSource === "previous_activity"
    ? t("hotel_route_origin_previous_activity")
    : originSource === "previous_hotel"
      ? t("hotel_route_origin_previous_hotel")
      : originSource === "trip_arrival"
        ? t("hotel_route_origin_trip_arrival")
        : originOverride?.source === "device"
          ? t("hotel_route_origin_device")
          : originOverride?.source === "manual"
            ? t("hotel_route_origin_manual")
            : "";

  return (
    <section className={`rounded-2xl border p-4 ${isCurrentDay ? "border-[var(--color-transport)] bg-[var(--color-transport)]/10" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--color-transport)]">{formatLocalDate(stop.date)} · {t("arrival_checkin_event")}{isCurrentDay ? ` · ${t("arrival_selected_day")}` : ""}</p>
          <h3 className="mt-1 truncate text-sm font-black text-[var(--color-text)]">{stop.destination}</h3>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{stop.title}</p>
          {stop.checkInTime ? (
            <p className="mt-2 text-xs font-semibold text-[var(--color-text-secondary)]">
              {t(stop.checkInSource === "itinerary" ? "arrival_checkin_from_itinerary" : "arrival_checkin_from_context", {
                time: stop.checkInTime,
                title: stop.title,
              })}
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t("arrival_activity_time_not_policy", { time: stop.scheduledTime })}</p>
          )}
        </div>
      </div>

      {origin && !editingOrigin ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <MapPin size={13} className="text-[var(--color-transport)]" />
          <span>{t("hotel_route_origin")}: {origin}</span>
          {originSourceLabel ? <span className="text-[var(--color-text-muted)]">({originSourceLabel})</span> : null}
          <button type="button" onClick={() => { setOriginDraft(origin); setEditingOrigin(true); }} className="font-bold text-[var(--color-transport)] underline">{t("hotel_route_change_origin")}</button>
        </div>
      ) : (
        <form onSubmit={saveManualOrigin} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[180px] flex-1 text-xs font-bold text-[var(--color-text-secondary)]">
            {t("hotel_route_origin")}
            <input
              value={originDraft}
              onChange={(event) => setOriginDraft(event.target.value)}
              placeholder={t("hotel_route_origin_placeholder")}
              maxLength={240}
              className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" className="rounded-xl bg-[var(--color-primary)] px-3 py-2 text-xs font-bold text-white">{t("hotel_route_save_origin")}</button>
          <button type="button" onClick={useCurrentLocation} disabled={locating} className="flex items-center gap-1.5 rounded-xl border border-[var(--color-transport)]/30 px-3 py-2 text-xs font-bold text-[var(--color-transport)] disabled:opacity-50">
            <Navigation size={13} /> {locating ? t("hotel_route_locating") : t("hotel_route_use_current")}
          </button>
          {error ? <p role="alert" className="w-full text-xs font-semibold text-[var(--color-danger)]">{error}</p> : null}
          <p className="w-full text-[10px] text-[var(--color-text-muted)]">{t("hotel_route_location_not_saved")}</p>
        </form>
      )}

      {origin ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {MAP_MODES.map(({ mode, titleKey, detailKey, icon: Icon }) => {
            const href = buildGoogleMapsDirectionsUrl(origin, stop.destination, mode);
            return href ? (
              <a key={mode} href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-16 items-start gap-2 rounded-xl border border-[var(--color-border)] p-3 transition hover:border-[var(--color-transport)]/30 hover:bg-[var(--color-transport)]/5">
                <Icon size={16} className="mt-0.5 shrink-0 text-[var(--color-transport)]" />
                <span><strong className="block text-xs font-black text-[var(--color-text)]">{t(titleKey)}</strong><span className="mt-1 block text-[10px] leading-relaxed text-[var(--color-text-muted)]">{t(detailKey)}</span></span>
              </a>
            ) : null;
          })}
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">{t("hotel_route_origin_needed")}</p>
      )}
    </section>
  );
}
