import { describe, expect, it } from "vitest";
import { buildTripContext } from "@/lib/ai/trip-context";
import { getCurrentTripDateTime, parseTravelContext } from "@/lib/travel-context";

describe("travel context validation", () => {
  it("keeps known travel facts and removes unsupported fields", () => {
    expect(parseTravelContext({
      version: 1,
      shareWithAI: true,
      travelerCount: 5,
      luggage: { carryOnBags: 5, checkedBags: 1 },
      arrival: {
        location: " ORY ",
        localDate: "2026-11-15",
        localTime: "14:30",
        timeZone: "Europe/Paris",
      },
      hotel: { name: "Hotel X", address: "Paris", checkIn: "15:00" },
      preferences: { minimizeWalking: true, avoidTransfers: true, budgetLevel: "medium" },
      secret: "drop me",
    })).toEqual({
      version: 1,
      shareWithAI: true,
      travelerCount: 5,
      luggage: { carryOnBags: 5, checkedBags: 1 },
      arrival: {
        location: "ORY",
        localDate: "2026-11-15",
        localTime: "14:30",
        timeZone: "Europe/Paris",
      },
      hotel: { name: "Hotel X", address: "Paris", checkIn: "15:00" },
      preferences: { minimizeWalking: true, avoidTransfers: true, budgetLevel: "medium" },
    });
  });

  it.each([
    { version: 1, travelerCount: 0 },
    { version: 1, travelerCount: 51 },
    { version: 1, luggage: { checkedBags: -1 } },
    { version: 1, arrival: { localDate: "2026-02-30" } },
    { version: 1, arrival: { timeZone: "Mars/Olympus" } },
    { version: 1, hotel: { checkIn: "25:00" } },
    { version: 1, shareWithAI: "yes" },
    { version: 2, travelerCount: 2 },
  ])("rejects invalid or unsupported contexts: %o", (context) => {
    expect(parseTravelContext(context)).toBeNull();
  });

  it("returns null when the context has no values", () => {
    expect(parseTravelContext({ version: 1 })).toBeNull();
  });

  it("includes travel context in the AI-safe trip context", () => {
    const travelContext = parseTravelContext({ version: 1, shareWithAI: true, travelerCount: 5 });
    const context = buildTripContext({
      trip: { id: "trip-1", name: "Paris", ownerId: "user-1", travelContext },
      days: [],
      reservations: [],
      currentDate: "2026-11-15",
      currentTime: "14:30",
    });

    expect(context.travelContext).toEqual({ version: 1, shareWithAI: true, travelerCount: 5 });
    expect(context.current).toMatchObject({ timeZone: null, timeZoneSource: "unknown" });
  });

  it("does not send travel context to the AI provider without explicit consent", () => {
    const travelContext = parseTravelContext({
      version: 1,
      shareWithAI: false,
      travelerCount: 5,
      arrival: { location: "Sensitive airport", timeZone: "Europe/Paris" },
      hotel: { name: "Private hotel", address: "12 Secret Street" },
    });
    const context = buildTripContext({
      trip: { id: "trip-1", name: "Paris", ownerId: "user-1", travelContext },
      days: [],
      reservations: [],
      currentDate: "2026-11-15",
      currentTime: "14:30",
      currentTimeZone: "Europe/Paris",
      currentTimeZoneSource: "trip_context",
    });

    expect(context.travelContext).toBeNull();
    expect(context.current).toMatchObject({ timeZone: "UTC", timeZoneSource: "utc_fallback" });
    expect(JSON.stringify(context)).not.toContain("Private hotel");
    expect(JSON.stringify(context)).not.toContain("Secret Street");
    expect(JSON.stringify(context)).not.toContain("Europe/Paris");
  });

  it("uses destination local time and identifies the UTC fallback", () => {
    const now = new Date("2026-11-15T23:30:00.000Z");

    expect(getCurrentTripDateTime(now, "Europe/Paris")).toMatchObject({
      date: "2026-11-16",
      time: "00:30",
      timeZone: "Europe/Paris",
      timeZoneSource: "trip_context",
    });
    expect(getCurrentTripDateTime(now)).toMatchObject({
      date: "2026-11-15",
      time: "23:30",
      timeZone: "UTC",
      timeZoneSource: "utc_fallback",
    });
    expect(getCurrentTripDateTime(now, "Mars/Olympus")).toMatchObject({
      timeZone: "UTC",
      timeZoneSource: "utc_fallback",
    });
  });
});
