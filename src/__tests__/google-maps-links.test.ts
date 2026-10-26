import { describe, expect, it } from "vitest";
import { buildGoogleMapsDirectionsUrl, buildGoogleMapsNavigationUrl } from "@/lib/google-maps-links";

describe("Google Maps quick route links", () => {
  it.each([
    ["walking", "walking"],
    ["transit", "transit"],
    ["driving", "driving"],
  ] as const)("builds a directions link for %s", (mode, expectedMode) => {
    const url = new URL(buildGoogleMapsDirectionsUrl("Paris ORY", "Hotel de Ville, Paris", mode)!);

    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("Paris ORY");
    expect(url.searchParams.get("destination")).toBe("Hotel de Ville, Paris");
    expect(url.searchParams.get("travelmode")).toBe(expectedMode);
  });

  it("returns no link when an endpoint is missing", () => {
    expect(buildGoogleMapsDirectionsUrl("ORY", "", "transit")).toBeNull();
    expect(buildGoogleMapsDirectionsUrl(" ", "Hotel", "walking")).toBeNull();
  });
});

describe("buildGoogleMapsNavigationUrl", () => {
  it("opens directions to the exact coordinates with the chosen travel mode", () => {
    const url = new URL(buildGoogleMapsNavigationUrl({ lat: 35.7148, lng: 139.7967 }, "transit")!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe("35.7148,139.7967");
    expect(url.searchParams.get("travelmode")).toBe("transit");
    // No origin: Google Maps starts from the traveler's current location.
    expect(url.searchParams.has("origin")).toBe(false);
  });

  it.each(["walking", "driving", "transit"] as const)("supports %s", (mode) => {
    expect(new URL(buildGoogleMapsNavigationUrl({ lat: 1, lng: 2 }, mode)!).searchParams.get("travelmode")).toBe(mode);
  });

  it("returns null instead of inventing a destination", () => {
    expect(buildGoogleMapsNavigationUrl({ lat: Number.NaN, lng: 2 }, "walking")).toBeNull();
    expect(buildGoogleMapsNavigationUrl({ lat: 1, lng: Number.POSITIVE_INFINITY }, "walking")).toBeNull();
    expect(buildGoogleMapsNavigationUrl({ lat: 91, lng: 2 }, "walking")).toBeNull();
  });
});
