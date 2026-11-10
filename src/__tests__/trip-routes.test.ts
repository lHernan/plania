import { describe, expect, it } from "vitest";
import { parseTripPath, tripPath } from "@/lib/trip-routes";

describe("trip routes", () => {
  it("builds the path of each section of a trip", () => {
    expect(tripPath("t1")).toBe("/trips/t1");
    expect(tripPath("t1", "itinerary")).toBe("/trips/t1");
    expect(tripPath("t1", "map")).toBe("/trips/t1/map");
    expect(tripPath("t1", "wallet")).toBe("/trips/t1/wallet");
    expect(tripPath("t1", "overview")).toBe("/trips/t1/overview");
    expect(tripPath("t1", "expenses")).toBe("/trips/t1/expenses");
  });

  it("reads the trip and section from a path", () => {
    expect(parseTripPath("/trips/t1")).toEqual({ tripId: "t1", section: "itinerary" });
    expect(parseTripPath("/trips/t1/map")).toEqual({ tripId: "t1", section: "map" });
    expect(parseTripPath("/trips/t1/expenses")).toEqual({ tripId: "t1", section: "expenses" });
    expect(parseTripPath("/trips/t1/wallet/")).toEqual({ tripId: "t1", section: "wallet" });
    expect(parseTripPath("/trips/a%20b/overview")).toEqual({ tripId: "a b", section: "overview" });
  });

  it("is not a trip path without a trip id or with an unknown section", () => {
    expect(parseTripPath("/")).toBeNull();
    expect(parseTripPath("/trips")).toBeNull();
    expect(parseTripPath("/trips/")).toBeNull();
    expect(parseTripPath("/trips/t1/unknown")).toBeNull();
    expect(parseTripPath("/share/tok")).toBeNull();
    expect(parseTripPath("/trips/%E0")).toBeNull();
  });
});
