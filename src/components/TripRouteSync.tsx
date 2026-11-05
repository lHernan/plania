"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseTripPath, tripPath } from "@/lib/trip-routes";
import { useItineraryStore } from "@/store/use-itinerary-store";

/**
 * Keeps the URL and the active trip in step once the trip is loaded (AuthInitializer loads
 * the first one from the URL): a new trip id in the URL opens that trip, and a trip opened
 * from inside the app (the trip switcher) moves the URL to it, keeping the section.
 * `?day=YYYY-MM-DD` selects that day whenever it changes, and the URL follows the selected day.
 */
export function TripRouteSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // From the address, not the route params: offline the service worker may serve another
  // trip's cached page here, and its params name that other trip.
  const urlTripId = parseTripPath(pathname)?.tripId ?? "";

  const activeTrip = useItineraryStore((s) => s.activeTrip);
  const activeDayId = useItineraryStore((s) => s.activeDayId);
  const hasFetched = useItineraryStore((s) => s.hasFetched);
  const switchTrip = useItineraryStore((s) => s.switchTrip);
  const setActiveDay = useItineraryStore((s) => s.setActiveDay);

  // The URL trip last acted on: null at first, so a URL that does not match the loaded
  // trip on arrival counts as the URL asking for a trip.
  const seenUrlTripId = useRef<string | null>(null);
  const pendingTripId = useRef<string | null>(null);
  // The trip and ?day= last applied to the store, so each new ?day= (on arrival or from a
  // link inside the app) is applied once before the selected day is written back.
  const appliedDayKey = useRef<string | null>(null);

  const activeTripId = activeTrip?.id;
  const section = parseTripPath(pathname)?.section ?? "itinerary";

  // Pages reached by in-app navigation are not cached by the service worker on their own.
  const cachedPaths = useRef(new Set<string>());
  useEffect(() => {
    if (!urlTripId || cachedPaths.current.has(pathname) || !navigator.onLine) return;
    const controller = navigator.serviceWorker?.controller;
    if (!controller) return;
    cachedPaths.current.add(pathname);
    controller.postMessage({ type: "CACHE_PAGE", url: `${window.location.origin}${pathname}` });
  }, [pathname, urlTripId]);

  useEffect(() => {
    if (!hasFetched || !activeTripId || !urlTripId || pendingTripId.current) return;
    const urlChanged = seenUrlTripId.current !== urlTripId;
    seenUrlTripId.current = urlTripId;
    if (urlTripId === activeTripId) return;

    if (urlChanged) {
      pendingTripId.current = urlTripId;
      void switchTrip(urlTripId).then(() => {
        pendingTripId.current = null;
        // Not available: the store opened another trip instead, so the URL follows it.
        const openedId = useItineraryStore.getState().activeTrip?.id;
        if (openedId && openedId !== urlTripId) {
          seenUrlTripId.current = openedId;
          router.replace(tripPath(openedId, section));
        }
      });
      return;
    }

    seenUrlTripId.current = activeTripId;
    router.replace(tripPath(activeTripId, section));
  }, [activeTripId, hasFetched, router, section, switchTrip, urlTripId]);

  const dayParam = searchParams?.get("day") ?? null;

  // Runs before the read below, so the day from the URL is not overwritten in the same pass.
  const dayKey = activeTrip ? `${activeTrip.id}|${dayParam ?? ""}` : null;

  useEffect(() => {
    if (!activeTrip || appliedDayKey.current !== dayKey) return;
    const date = activeTrip.days.find((d) => d.id === activeDayId)?.date;
    if (!date || date === dayParam) return;
    const url = new URL(window.location.href);
    url.searchParams.set("day", date);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [activeDayId, activeTrip, dayKey, dayParam]);

  useEffect(() => {
    if (!activeTrip || activeTrip.id !== urlTripId || appliedDayKey.current === dayKey) return;
    appliedDayKey.current = dayKey;
    const day = dayParam ? activeTrip.days.find((d) => d.date === dayParam) : undefined;
    if (day) setActiveDay(day.id);
  }, [activeTrip, dayKey, dayParam, setActiveDay, urlTripId]);

  return null;
}
