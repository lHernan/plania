"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, Loader2, Navigation, Check, Clock, MapPin, ChevronRight, RotateCcw, MapPinOff } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useGeocodeCache, type GeocodedLocation } from "@/hooks/use-geocode-cache";
import { filterActivitiesByMapStatus, isActivityCompleted, type MapStatusFilter } from "@/lib/trip-progress";
import type { Activity } from "@/lib/types";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Pending: solid brand green with order number. Completed: soft green with a check glyph,
// so the state never depends on color alone.
function makeMarkerIcon(order: number, title: string, completed: boolean, active: boolean) {
  const maxLen = active ? 22 : 14;
  const label = escapeHtml(title.length > maxLen ? title.slice(0, maxLen - 1) + "…" : title);
  const badge = completed
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--color-primary);color:white;font-size:10px;line-height:1;">✓</span>`
    : `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:white;color:var(--color-primary);font-size:10px;line-height:1;">${order}</span>`;
  return L.divIcon({
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div style="
      transform:translate(-50%,-50%);
      display:inline-flex;align-items:center;gap:5px;
      padding:${active ? "5px 10px 5px 5px" : "4px 8px 4px 4px"};border-radius:20px;
      background:${completed ? "var(--color-primary-subtle)" : "var(--color-primary)"};
      border:2px solid ${completed ? "var(--color-primary)" : "white"};
      color:${completed ? "var(--color-primary)" : "white"};
      font-size:${active ? 12 : 11}px;font-weight:700;white-space:nowrap;
      box-shadow:${active ? "0 0 0 4px rgba(36,107,87,0.25)," : ""}0 2px 6px rgba(0,0,0,0.25);
    ">${badge}<span>${label}</span></div>`,
  });
}

const userLocationIcon = L.divIcon({
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<div style="
    width:18px;height:18px;border-radius:50%;
    background:#4285F4;border:3px solid white;
    box-shadow:0 0 0 4px rgba(66,133,244,0.25), 0 2px 6px rgba(0,0,0,0.3);
  "></div>`,
});

function isValidLatLng(pos: [number, number]): boolean {
  return Number.isFinite(pos[0]) && Number.isFinite(pos[1]);
}

/**
 * Fits the camera to the visible markers when the day or filter changes. Later marker
 * changes only refit while the user hasn't panned/zoomed manually.
 */
function MapCamera({
  positions,
  resetKey,
  activePosition,
}: {
  positions: [number, number][];
  resetKey: string;
  activePosition: [number, number] | null;
}) {
  const map = useMap();
  const userMovedRef = useRef(false);
  const lastResetKeyRef = useRef<string | null>(null);
  const lastSignatureRef = useRef("");

  useMapEvents({
    dragstart: () => { userMovedRef.current = true; },
  });

  useEffect(() => {
    const container = map.getContainer();
    const markMoved = () => { userMovedRef.current = true; };
    const onTouch = (e: TouchEvent) => { if (e.touches.length > 1) markMoved(); };
    container.addEventListener("wheel", markMoved, { passive: true });
    container.addEventListener("touchstart", onTouch, { passive: true });
    return () => {
      container.removeEventListener("wheel", markMoved);
      container.removeEventListener("touchstart", onTouch);
    };
  }, [map]);

  useEffect(() => {
    const valid = positions.filter(isValidLatLng);
    const signature = valid.map((p) => p.join(",")).join("|");
    const isReset = lastResetKeyRef.current !== resetKey;
    if (isReset) userMovedRef.current = false;
    lastResetKeyRef.current = resetKey;

    // Nothing visible: keep the current view instead of inventing a position.
    if (valid.length === 0) return;
    if (!isReset && (signature === lastSignatureRef.current || userMovedRef.current)) return;
    lastSignatureRef.current = signature;

    try {
      map.stop(); // cancel ongoing animations to avoid NaN interpolation
      if (valid.length === 1) {
        map.setView(valid[0], 15, { animate: false });
      } else {
        map.fitBounds(valid, { padding: [60, 60], maxZoom: 16, animate: false });
      }
    } catch { /* Leaflet bounds error — ignore */ }
  }, [map, positions, resetKey]);

  useEffect(() => {
    if (!activePosition || !isValidLatLng(activePosition)) return;
    try {
      map.stop();
      // Use setView instead of flyTo — flyTo's hyperbolic interpolation
      // produces NaN when source and destination are very close
      map.setView(activePosition, Math.max(map.getZoom(), 15), {
        animate: true,
        duration: 0.3,
      });
    } catch { /* Leaflet view error — ignore */ }
  }, [map, activePosition]);

  return null;
}

function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

type MarkerItem = { activity: Activity; coords: GeocodedLocation; order: number };

type DayMapViewProps = {
  dayId: string;
  activities: Activity[];
  city: string;
  anchor?: { lat: number; lng: number };
  activeActivityId: string | null;
  canEdit?: boolean;
  onActivitySelect: (activityId: string | null) => void;
  onToggleComplete: (activityId: string, completed: boolean) => void;
  onOpenDetails: (activityId: string) => void;
  onClose: () => void;
};

const FILTERS: { value: MapStatusFilter; labelKey: string }[] = [
  { value: "all", labelKey: "map_filter_all" },
  { value: "pending", labelKey: "map_filter_pending" },
  { value: "completed", labelKey: "map_filter_completed" },
];

export default function DayMapView({
  dayId,
  activities,
  city,
  anchor,
  activeActivityId,
  canEdit = true,
  onActivitySelect,
  onToggleComplete,
  onOpenDetails,
  onClose,
}: DayMapViewProps) {
  const { t } = useI18n();
  const { getCoords, geocodeActivities, isLoading } = useGeocodeCache();
  const [filter, setFilter] = useState<MapStatusFilter>("all");

  useEffect(() => {
    geocodeActivities(activities, city, anchor);
  }, [activities, city, anchor, geocodeActivities]);

  // Every geolocated activity of the day — completed ones stay as memories.
  // Order is by time so a marker's number doesn't change when it's crossed off.
  const allMarkers = useMemo(() => {
    const ordered = [...activities].sort((a, b) => a.time.localeCompare(b.time) || a.sort_order - b.sort_order);
    const result: MarkerItem[] = [];
    ordered.forEach((a, index) => {
      if (!a.location) return;
      const coords = getCoords(a.location);
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        result.push({ activity: a, coords, order: index + 1 });
      }
    });
    return result;
    // isLoading flips when geocoding resolves, which changes getCoords results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, getCoords, isLoading]);

  const markers = useMemo(() => {
    const visibleIds = new Set(filterActivitiesByMapStatus(allMarkers.map((m) => m.activity), filter).map((a) => a.id));
    return allMarkers.filter((m) => visibleIds.has(m.activity.id));
  }, [allMarkers, filter]);

  const counts = useMemo(() => {
    const completed = allMarkers.filter((m) => isActivityCompleted(m.activity)).length;
    return { all: allMarkers.length, completed, pending: allMarkers.length - completed };
  }, [allMarkers]);

  const dayComplete = activities.length > 0 && activities.every(isActivityCompleted);

  const anchorPos: [number, number] | null = useMemo(() => {
    if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) return null;
    return [anchor.lat, anchor.lng];
  }, [anchor]);

  const markerPositions = useMemo(
    () => markers.map((m) => [m.coords.lat, m.coords.lng] as [number, number]).filter(isValidLatLng),
    [markers]
  );

  // Fit includes the anchor only when there is something visible to frame.
  const fitPositions = useMemo(
    () => (markerPositions.length > 0 && anchorPos ? [anchorPos, ...markerPositions] : markerPositions),
    [anchorPos, markerPositions]
  );

  const selected = useMemo(
    () => markers.find((m) => m.activity.id === activeActivityId) ?? null,
    [activeActivityId, markers]
  );

  const activePosition = useMemo(() => {
    if (!selected) return null;
    const pos: [number, number] = [selected.coords.lat, selected.coords.lng];
    return isValidLatLng(pos) ? pos : null;
  }, [selected]);

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="size-9 shrink-0 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center shadow-sm hover:bg-[var(--color-surface-subtle)] transition-colors"
      aria-label={t("map_close")}
      title={t("map_close")}
    >
      <X size={15} className="text-[var(--color-text)]" />
    </button>
  );

  if (isLoading) {
    return (
      <div className="relative flex flex-col items-center justify-center h-full bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)]">
        <div className="absolute top-3 right-3">{closeButton}</div>
        <Loader2 size={24} className="animate-spin text-[var(--color-primary)] mb-2" />
        <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
          {t("map_loading")}
        </span>
      </div>
    );
  }

  if (allMarkers.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center gap-2 h-full p-8 text-center bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)]">
        <div className="absolute top-3 right-3">{closeButton}</div>
        <MapPinOff size={28} className="text-[var(--color-text-muted)]" aria-hidden="true" />
        <p className="text-sm font-bold text-[var(--color-text)]">{t("map_no_locations")}</p>
        <p className="text-xs text-[var(--color-text-secondary)] max-w-[240px]">{t("map_no_locations_hint")}</p>
      </div>
    );
  }

  const filterEmptyMessage =
    markers.length === 0
      ? filter === "pending"
        ? t("map_filter_pending_empty")
        : filter === "completed"
          ? t("map_filter_completed_empty")
          : null
      : null;

  return (
    <div className="relative h-full rounded-2xl overflow-hidden border border-[var(--color-border)] [&_.leaflet-top.leaflet-right]:mt-14">
      {/* TOP BAR: filters + close */}
      <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[1000] flex items-start justify-between gap-2 pointer-events-none">
        <div
          role="group"
          aria-label={t("map_filter_label")}
          className="pointer-events-auto inline-flex rounded-full bg-[var(--color-surface)]/95 border border-[var(--color-border)] p-1 shadow-sm backdrop-blur-sm"
        >
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.value)}
                className={`min-h-8 px-3 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                  active
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
                }`}
              >
                {t(f.labelKey)}
                <span className={`ml-1 tabular-nums ${active ? "text-white/75" : "text-[var(--color-text-muted)]"}`}>
                  {counts[f.value]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="pointer-events-auto">{closeButton}</div>
      </div>

      {/* Day completed: discreet memory note, never an empty state */}
      {dayComplete && filter !== "pending" && !selected && (
        <div
          role="note"
          className="absolute left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-[1000] w-[calc(100%-1.5rem)] max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-sm backdrop-blur-sm"
        >
          <p className="text-sm font-black text-[var(--color-text)]">{t("tachao_day")}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">{t("map_day_complete_sub")}</p>
        </div>
      )}

      {/* Filter-specific empty state — the map stays visible */}
      {filterEmptyMessage && (
        <div
          role="status"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[1000] w-[calc(100%-3rem)] max-w-xs rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 text-center shadow-sm backdrop-blur-sm pointer-events-none"
        >
          <p className="text-sm font-bold text-[var(--color-text)]">{filterEmptyMessage}</p>
        </div>
      )}

      {/* Selected activity: bottom card (mobile bottom-sheet style, compact panel on desktop) */}
      {selected && (
        <MarkerDetailCard
          item={selected}
          canEdit={canEdit}
          onClose={() => onActivitySelect(null)}
          onOpenDetails={() => onOpenDetails(selected.activity.id)}
          onToggleComplete={() => onToggleComplete(selected.activity.id, !isActivityCompleted(selected.activity))}
        />
      )}

      <MapContainer
        center={fitPositions[0] ?? markerPositions[0] ?? [allMarkers[0].coords.lat, allMarkers[0].coords.lng]}
        zoom={13}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="topright" />

        <MapCamera positions={fitPositions} resetKey={`${dayId}|${filter}`} activePosition={activePosition} />

        {/* "You are here" blue dot */}
        {anchorPos && (
          <Marker position={anchorPos} icon={userLocationIcon}>
            <Popup autoPan={false}>
              <span className="text-xs font-bold">{t("map_you_are_here")}</span>
            </Popup>
          </Marker>
        )}

        {markers.map((m) => {
          const completed = isActivityCompleted(m.activity);
          const active = m.activity.id === activeActivityId;
          return (
            <Marker
              key={m.activity.id}
              position={[m.coords.lat, m.coords.lng]}
              icon={makeMarkerIcon(m.order, m.activity.title, completed, active)}
              zIndexOffset={active ? 1000 : completed ? 0 : 500}
              title={`${m.order}. ${m.activity.title} — ${completed ? t("map_status_completed") : t("map_status_pending")}`}
              keyboard
              eventHandlers={{
                click: () => onActivitySelect(m.activity.id),
                keypress: (e) => {
                  const key = (e.originalEvent as KeyboardEvent).key;
                  if (key === "Enter" || key === " ") onActivitySelect(m.activity.id);
                },
              }}
            />
          );
        })}

        {markerPositions.length > 1 && (
          <Polyline
            positions={markerPositions}
            pathOptions={{
              color: "var(--color-primary)",
              weight: 2,
              dashArray: "8, 8",
              opacity: 0.5,
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}

function MarkerDetailCard({
  item,
  canEdit,
  onClose,
  onOpenDetails,
  onToggleComplete,
}: {
  item: MarkerItem;
  canEdit: boolean;
  onClose: () => void;
  onOpenDetails: () => void;
  onToggleComplete: () => void;
}) {
  const { t } = useI18n();
  const { activity, coords, order } = item;
  const completed = isActivityCompleted(activity);

  return (
    <div
      role="dialog"
      aria-label={activity.title}
      className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] z-[1000] md:right-auto md:w-80 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("map_close_card")}
        className="absolute right-2 top-2 size-8 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
      >
        <X size={15} />
      </button>

      <div className="flex items-center gap-2 pr-8">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            completed
              ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
              : "bg-[var(--color-primary)] text-white"
          }`}
        >
          {completed ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : <span className="tabular-nums">{order}</span>}
          {completed ? t("map_status_completed") : t("map_status_pending")}
        </span>
        {activity.time && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-[var(--color-text-secondary)]">
            <Clock size={12} aria-hidden="true" /> {activity.time}
          </span>
        )}
      </div>

      <h3 className="mt-2 text-base font-extrabold leading-tight text-[var(--color-text)] pr-6">{activity.title}</h3>
      {activity.location && (
        <p className="mt-1 flex items-start gap-1 text-xs text-[var(--color-text-secondary)]">
          <MapPin size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">{activity.location}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit && (
          <button
            type="button"
            onClick={onToggleComplete}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition-colors ${
              completed
                ? "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
                : "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]"
            }`}
          >
            {completed ? <RotateCcw size={14} aria-hidden="true" /> : <Check size={14} strokeWidth={3} aria-hidden="true" />}
            {completed ? t("map_mark_pending") : t("map_mark_completed")}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenDetails}
          className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[var(--color-border)] px-3.5 text-xs font-bold text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
        >
          {t("map_open_details")} <ChevronRight size={14} aria-hidden="true" />
        </button>
        <a
          href={directionsUrl(coords.lat, coords.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center gap-1 px-1 text-xs font-bold text-[var(--color-primary)] hover:underline"
        >
          <Navigation size={12} aria-hidden="true" />
          {t("map_get_directions")}
        </a>
      </div>
    </div>
  );
}
