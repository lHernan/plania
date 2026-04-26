"use client";

import { TripView } from "@/components/TripView";

/**
 * /trips — the main itinerary view.
 * AuthInitializer (in layout) redirects here when activeTrip is ready,
 * and redirects back to / if no trips are found after fetch.
 */
export default function TripsPage() {
  return <TripView />;
}
