import { useCallback, useRef, useState } from "react";
import type { Activity } from "@/lib/types";

export type GeocodedLocation = { lat: number; lng: number };

type CacheEntry =
  | { status: "resolved"; coords: GeocodedLocation }
  | { status: "pending" };

function normalizeKey(location: string): string {
  return location.trim().toLowerCase();
}

type GeocodeResult =
  | { location: string; lat: number; lng: number }
  | { location: string; error: string };

export function useGeocodeCache() {
  const cache = useRef<Map<string, CacheEntry>>(new Map());
  // Requests in flight, not a boolean: the whole-trip map geocodes one batch per day
  // concurrently, and every batch that resolves must re-render with its new coordinates.
  const [pendingRequests, setPendingRequests] = useState(0);
  const isLoading = pendingRequests > 0;

  const getCoords = useCallback(
    (location: string): GeocodedLocation | null => {
      const entry = cache.current.get(normalizeKey(location));
      return entry?.status === "resolved" ? entry.coords : null;
    },
    [],
  );

  const geocodeActivities = useCallback(
    async (activities: Activity[], city: string, anchor?: { lat: number; lng: number }) => {
      const missing: string[] = [];

      for (const a of activities) {
        if (!a.location) continue;
        const key = normalizeKey(a.location);
        const entry = cache.current.get(key);
        // Skip only resolved or in-flight entries — errors are retried
        if (entry) continue;
        cache.current.set(key, { status: "pending" });
        missing.push(a.location);
      }

      if (missing.length === 0) return;

      setPendingRequests((n) => n + 1);
      try {
        const res = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locations: missing,
            city,
            anchorLat: anchor?.lat,
            anchorLng: anchor?.lng,
          }),
        });

        if (!res.ok) {
          // Remove pending entries so they can be retried
          for (const loc of missing) {
            cache.current.delete(normalizeKey(loc));
          }
          return;
        }

        const data = (await res.json()) as { results: GeocodeResult[] };

        for (const result of data.results) {
          const key = normalizeKey(result.location);
          if (
            "lat" in result &&
            Number.isFinite(result.lat) &&
            Number.isFinite(result.lng)
          ) {
            cache.current.set(key, {
              status: "resolved",
              coords: { lat: result.lat, lng: result.lng },
            });
          } else {
            // Don't cache errors — allow retry on next render
            cache.current.delete(key);
          }
        }
      } catch {
        for (const loc of missing) {
          cache.current.delete(normalizeKey(loc));
        }
      } finally {
        setPendingRequests((n) => n - 1);
      }
    },
    [],
  );

  return { getCoords, geocodeActivities, isLoading };
}
