import { describe, expect, it } from "vitest";
import { buildGoogleMapsDirectionsUrl } from "@/lib/google-maps-links";

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
