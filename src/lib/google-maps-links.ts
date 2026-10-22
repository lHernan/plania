export type GoogleMapsTravelMode = "walking" | "transit" | "driving";

export function buildGoogleMapsDirectionsUrl(origin: string, destination: string, travelMode: GoogleMapsTravelMode) {
  const normalizedOrigin = origin.trim();
  const normalizedDestination = destination.trim();
  if (!normalizedOrigin || !normalizedDestination) return null;

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", normalizedOrigin);
  url.searchParams.set("destination", normalizedDestination);
  url.searchParams.set("travelmode", travelMode);
  return url.toString();
}

export function buildTripMapUrl(locations: string[]) {
  const cleaned = locations.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) {
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", cleaned[0]);
    return url.toString();
  }
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", cleaned[0]);
  url.searchParams.set("destination", cleaned[cleaned.length - 1]);
  if (cleaned.length > 2) {
    url.searchParams.set("waypoints", cleaned.slice(1, -1).join("|"));
  }
  url.searchParams.set("travelmode", "walking");
  return url.toString();
}
