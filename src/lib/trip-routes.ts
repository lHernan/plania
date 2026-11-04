/** The four sections of a trip; the itinerary lives at the trip's own path. */
export const TRIP_SECTIONS = ["itinerary", "map", "wallet", "overview"] as const;

export type TripSection = (typeof TRIP_SECTIONS)[number];

export function tripPath(tripId: string, section: TripSection = "itinerary"): string {
  const base = `/trips/${encodeURIComponent(tripId)}`;
  return section === "itinerary" ? base : `${base}/${section}`;
}

/** The trip and section a path points to, or null when it is not a trip section. */
export function parseTripPath(pathname: string): { tripId: string; section: TripSection } | null {
  const [root, rawId, rawSection, ...rest] = pathname.split("/").filter(Boolean);
  if (root !== "trips" || !rawId || rest.length > 0) return null;
  const section = (rawSection ?? "itinerary") as TripSection;
  if (rawSection === "itinerary" || !TRIP_SECTIONS.includes(section)) return null;
  return { tripId: decodeURIComponent(rawId), section };
}
