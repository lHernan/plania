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
