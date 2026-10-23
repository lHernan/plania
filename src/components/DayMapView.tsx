"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, Loader2, Navigation } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useGeocodeCache, type GeocodedLocation } from "@/hooks/use-geocode-cache";
import type { Activity, ActivityCategory } from "@/lib/types";

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  sightseeing: "#246B57",
  reservation: "#246B57",
  transport: "#3269B2",
  hotel: "#966B32",
  food: "#B54747",
  shopping: "#A779C5",
  photos: "#3269B2",
  nightlife: "#A779C5",
  other: "#777C75",
};

function makeMarkerIcon(color: string, title: string, active: boolean) {
  const maxLen = active ? 20 : 14;
  const label = title.length > maxLen ? title.slice(0, maxLen - 1) + "…" : title;
  const border = active ? 3 : 2;
  return L.divIcon({
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<div style="
      transform:translate(-50%,-50%);
      display:inline-flex;align-items:center;
      padding:${active ? "5px 10px" : "4px 8px"};border-radius:20px;
      background:${color};border:${border}px solid white;
      color:white;font-size:${active ? 11 : 10}px;font-weight:700;
      white-space:nowrap;
      box-shadow:0 2px 6px rgba(0,0,0,0.3);
      ${active ? "z-index:1000;" : ""}
    ">${label}</div>`,
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

function MapAutoFit({
  positions,
  activePosition,
}: {
  positions: [number, number][];
  activePosition: [number, number] | null;
}) {
  const map = useMap();

  useEffect(() => {
    const valid = positions.filter(isValidLatLng);
    if (valid.length === 0) return;
    try {
      map.stop(); // cancel ongoing animations to avoid NaN interpolation
      if (valid.length === 1) {
        map.setView(valid[0], 15, { animate: false });
      } else {
        map.fitBounds(valid, { padding: [50, 50], maxZoom: 16, animate: false });
      }
    } catch { /* Leaflet bounds error — ignore */ }
  }, [map, positions]);

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

type DayMapViewProps = {
  activities: Activity[];
  city: string;
  anchor?: { lat: number; lng: number };
  activeActivityId: string | null;
  onActivitySelect: (activityId: string) => void;
  onClose: () => void;
};

export default function DayMapView({
  activities,
  city,
  anchor,
  activeActivityId,
  onActivitySelect,
  onClose,
}: DayMapViewProps) {
  const { t } = useI18n();
  const { getCoords, geocodeActivities, isLoading } = useGeocodeCache();

  useEffect(() => {
    geocodeActivities(activities, city, anchor);
  }, [activities, city, anchor, geocodeActivities]);

  // Only show pending activities — completed ones are removed from the map
  const markers = useMemo(() => {
    const result: { activity: Activity; coords: GeocodedLocation }[] = [];
    for (const a of activities) {
      if (!a.location || a.state === "completed") continue;
      const coords = getCoords(a.location);
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        result.push({ activity: a, coords });
      }
    }
    return result;
  }, [activities, getCoords, isLoading]);

  const anchorPos: [number, number] | null = useMemo(() => {
    if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) return null;
    return [anchor.lat, anchor.lng];
  }, [anchor]);

  // All positions for fitting the map — includes anchor + activity markers
  const fitPositions = useMemo(() => {
    const pts: [number, number][] = [];
    if (anchorPos) pts.push(anchorPos);
    for (const m of markers) {
      pts.push([m.coords.lat, m.coords.lng]);
    }
    return pts.filter(isValidLatLng);
  }, [anchorPos, markers]);

  // Route polyline: anchor (start) → activity 1 → activity 2 → ...
  const routePositions = useMemo(() => {
    const pts: [number, number][] = [];
    if (anchorPos) pts.push(anchorPos);
    for (const m of markers) {
      pts.push([m.coords.lat, m.coords.lng]);
    }
    return pts.filter(isValidLatLng);
  }, [anchorPos, markers]);

  const activePosition = useMemo(() => {
    if (!activeActivityId) return null;
    const found = markers.find((m) => m.activity.id === activeActivityId);
    if (!found) return null;
    const pos: [number, number] = [found.coords.lat, found.coords.lng];
    return isValidLatLng(pos) ? pos : null;
  }, [activeActivityId, markers]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)]">
        <Loader2 size={24} className="animate-spin text-[var(--color-primary)] mb-2" />
        <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
          {t("map_loading")}
        </span>
      </div>
    );
  }

  if (markers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)]">
        <span className="text-sm text-[var(--color-text-muted)]">
          {t("map_no_locations")}
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full rounded-2xl overflow-hidden border border-[var(--color-border)]">
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-[1000] size-8 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center shadow-md hover:bg-[var(--color-surface-subtle)] transition-colors"
        title={t("map_close")}
      >
        <X size={14} className="text-[var(--color-text)]" />
      </button>

      <MapContainer
        center={fitPositions[0] ?? [0, 0]}
        zoom={13}
        className="h-full w-full"
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapAutoFit positions={fitPositions} activePosition={activePosition} />

        {/* "You are here" blue dot */}
        {anchorPos && (
          <Marker position={anchorPos} icon={userLocationIcon}>
            <Popup autoPan={false}>
              <span className="text-xs font-bold">{t("map_you_are_here")}</span>
            </Popup>
          </Marker>
        )}

        {markers.map((m) => (
          <Marker
            key={m.activity.id}
            position={[m.coords.lat, m.coords.lng]}
            icon={makeMarkerIcon(
              CATEGORY_COLORS[m.activity.category] ?? CATEGORY_COLORS.other,
              m.activity.title,
              m.activity.id === activeActivityId,
            )}
            eventHandlers={{
              popupopen: () => onActivitySelect(m.activity.id),
            }}
          >
            <Popup autoPan={false}>
              <div className="min-w-[140px] space-y-1.5">
                <div className="font-bold text-sm leading-tight">{m.activity.title}</div>
                {m.activity.time && (
                  <div className="text-xs text-gray-500">{m.activity.time}</div>
                )}
                <a
                  href={directionsUrl(m.coords.lat, m.coords.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 mt-1"
                >
                  <Navigation size={11} />
                  {t("map_get_directions")}
                </a>
              </div>
            </Popup>
          </Marker>
        ))}

        {routePositions.length > 1 && (
          <Polyline
            positions={routePositions}
            pathOptions={{
              color: "var(--color-primary)",
              weight: 2,
              dashArray: "8, 8",
              opacity: 0.6,
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
