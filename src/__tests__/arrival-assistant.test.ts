import { describe, expect, it } from "vitest";
import { compareArrivalOptions, estimateHotelArrival, getHotelArrivalStopsForDay, resolveHotelArrivalStops, resolveHotelCheckIn, resolveHotelDestination } from "@/lib/arrival-assistant";
import { parseTravelContext } from "@/lib/travel-context";
import type { Activity, ArrivalOption, TravelContext, TripDay } from "@/lib/types";

function option(overrides: Partial<ArrivalOption> = {}): ArrivalOption {
  return {
    id: "metro",
    name: "Metro",
    mode: "public_transport",
    amount: 4.5,
    priceBasis: "per_person",
    currency: "EUR",
    durationMin: 60,
    transfers: 2,
    walkingMin: 15,
    comfortScore: 2,
    source: "Official transit site",
    sourceCheckedAt: "2026-10-08T12:00:00.000Z",
    isEstimate: false,
    ...overrides,
  };
}

const groupContext: TravelContext = {
  version: 1,
  travelerCount: 5,
  luggage: { carryOnBags: 5, checkedBags: 1 },
  arrival: { location: "ORY", localDate: "2026-11-19", localTime: "14:30", timeZone: "Europe/Paris" },
  hotel: { name: "Hotel", address: "Paris", checkIn: "15:00" },
};

function hotelActivity(
  title: string,
  time: string,
  id: string,
  date: string,
  state: Activity["state"] = "pending",
  location?: string,
): TripDay {
  const activity: Activity = {
    id,
    dayId: "arrival-day",
    tripId: "trip-1",
    userId: "user-1",
    city: "Paris",
    title,
    time,
    durationMin: 30,
    location,
    category: "hotel",
    priority: "medium",
    state,
    sort_order: 0,
  };
  return { id: "arrival-day", date, city: "Paris", label: "Arrival", userId: "user-1", activities: [activity] };
}

describe("arrival transport comparison", () => {
  it("calculates per-person and whole-group totals for the traveler group", () => {
    const result = compareArrivalOptions([
      option({ amount: 4.5, priceBasis: "per_person" }),
      option({ id: "car", name: "Car", amount: 31, priceBasis: "whole_group", durationMin: 30 }),
    ], groupContext);

    expect(result.options.map((item) => item.totalGroupCost)).toEqual([22.5, 31]);
    expect(result.recommendationId).toBeDefined();
  });

  it.each([1, 2, 5, 6])("calculates per-person fare totals for %i travelers", (travelerCount) => {
    const result = compareArrivalOptions([
      option({ amount: 4.5 }),
      option({ id: "taxi", name: "Taxi", amount: 31, priceBasis: "whole_group", durationMin: 30 }),
    ], { version: 1, travelerCount });

    expect(result.options[0].totalGroupCost).toBe(Math.round(4.5 * travelerCount * 100) / 100);
  });

  it("respects zero- and three-decimal currency precision", () => {
    const kwd = compareArrivalOptions([
      option({ currency: "KWD", amount: 0.333 }),
      option({ id: "group", currency: "KWD", amount: 1.2, priceBasis: "whole_group" }),
    ], { version: 1, travelerCount: 3 });
    const jpy = compareArrivalOptions([
      option({ currency: "JPY", amount: 101 }),
      option({ id: "group", currency: "JPY", amount: 250, priceBasis: "whole_group" }),
    ], { version: 1, travelerCount: 2 });

    expect(kwd.options[0].totalGroupCost).toBe(0.999);
    expect(jpy.options[0].totalGroupCost).toBe(202);
  });

  it("multiplies a per-vehicle quote by required passenger and luggage capacity", () => {
    const result = compareArrivalOptions([
      option({ priceBasis: "per_vehicle", amount: 25, vehicleCapacity: 4, luggageCapacity: 2 }),
      option({ id: "van", name: "Van", priceBasis: "whole_group", amount: 80, durationMin: 35 }),
    ], groupContext);

    expect(result.options[0]).toMatchObject({ totalGroupCost: 75, vehiclesRequired: 3 });
  });

  it("does not recommend on price alone when a faster, more comfortable option scores better", () => {
    const result = compareArrivalOptions([
      option(),
      option({ id: "car", name: "Car", amount: 15, durationMin: 30, transfers: 0, walkingMin: 2, comfortScore: 5 }),
    ], groupContext);

    expect(result.recommendationId).toBe("car");
    expect(result.reason).toMatchObject({ cheapestTotal: 22.5, recommendedTotal: 75, cheapestDurationMin: 60, recommendedDurationMin: 30 });
    expect(result.criteria).toEqual(["price", "duration", "comfort", "walking", "transfers"]);
  });

  it("reweights the choice when the group marks comfort as a high priority", () => {
    const options = [
      option({ amount: 10, durationMin: 60, comfortScore: 3, walkingMin: 5, transfers: 0 }),
      option({ id: "car", name: "Car", amount: 15, durationMin: 30, comfortScore: 3, walkingMin: 5, transfers: 0 }),
    ];
    const priceFocused = compareArrivalOptions(options, { ...groupContext, preferences: { budgetLevel: "low" } });
    const comfortFocused = compareArrivalOptions(options, { ...groupContext, preferences: { budgetLevel: "high" } });

    expect(priceFocused.recommendationId).toBe("metro");
    expect(comfortFocused.recommendationId).toBe("car");
  });

  it.each([
    { options: [option()], context: groupContext, reason: "need_two_options" },
    { options: [option(), option({ id: "car", priceBasis: "whole_group" })], context: { version: 1 }, reason: "traveler_count_required" },
    { options: [option(), option({ id: "car", currency: "USD" })], context: groupContext, reason: "currency_mismatch" },
  ] as const)("withholds recommendation when comparison is incomplete: $reason", ({ options, context, reason }) => {
    expect(compareArrivalOptions([...options], context).unavailableReason).toBe(reason);
  });

  it("excludes an optional dimension if any option lacks it", () => {
    const result = compareArrivalOptions([
      option({ comfortScore: undefined, walkingMin: undefined, transfers: undefined }),
      option({ id: "car", comfortScore: undefined, walkingMin: undefined, transfers: undefined }),
    ], groupContext);

    expect(result.criteria).toEqual(["price", "duration"]);
  });

  it("blocks vehicle quotes when passenger or luggage capacity inputs are missing", () => {
    const context = { version: 1 as const, travelerCount: 5 };
    const result = compareArrivalOptions([
      option({ priceBasis: "per_vehicle", vehicleCapacity: 4 }),
      option({ id: "metro", priceBasis: "whole_group" }),
    ], context);

    expect(result.unavailableReason).toBe("vehicle_capacity_required");
  });
});

describe("hotel check-in arrival estimate", () => {
  it("only returns check-ins on the selected itinerary day", () => {
    const stops = [
      { id: "past", date: "2026-11-19", title: "Past", destination: "Hotel A", scheduledTime: "12:00" },
      { id: "next", date: "2026-11-21", title: "Next", destination: "Hotel C", scheduledTime: "09:00" },
      { id: "today", date: "2026-11-20", title: "Today", destination: "Hotel B", scheduledTime: "15:00" },
    ];

    expect(getHotelArrivalStopsForDay(stops, "2026-11-20").map((stop) => stop.id)).toEqual(["today"]);
    expect(getHotelArrivalStopsForDay(stops, "2026-11-22")).toEqual([]);
    expect(getHotelArrivalStopsForDay(stops)).toEqual([]);
  });

  it("resolves each hotel check-in with its own itinerary origin across trip days", () => {
    const arrival: Activity = {
      id: "arrival",
      dayId: "day-1",
      tripId: "trip-1",
      userId: "user-1",
      city: "Paris",
      title: "Arrival at ORY",
      time: "14:00",
      durationMin: 30,
      location: "ORY Airport",
      category: "transport",
      priority: "high",
      state: "pending",
      sort_order: 0,
    };
    const firstHotel = hotelActivity("Check-in Hotel A", "15:00", "hotel-a", "2026-11-19", "pending", "Hotel A").activities[0];
    const secondHotel = hotelActivity("Check-in Hotel B", "10:00", "hotel-b", "2026-11-20", "pending", "Hotel B").activities[0];
    const days: TripDay[] = [
      { id: "day-1", date: "2026-11-19", city: "Paris", label: "Arrival", userId: "user-1", activities: [arrival, firstHotel] },
      { id: "day-2", date: "2026-11-20", city: "Paris", label: "Hotel change", userId: "user-1", activities: [secondHotel] },
    ];

    expect(resolveHotelArrivalStops(groupContext, days)).toMatchObject([
      { id: "hotel-a", destination: "Hotel A", origin: "ORY Airport", originSource: "previous_activity" },
      { id: "hotel-b", destination: "Hotel B", origin: "Hotel A", originSource: "previous_hotel" },
    ]);
  });

  it("uses the hotel activity location as destination without treating a transfer time as check-in", () => {
    const context: TravelContext = {
      version: 1,
      travelerCount: 5,
      arrival: { location: "ORY", localDate: "2026-11-19", localTime: "14:30", timeZone: "Europe/Paris" },
    };
    const days = [hotelActivity("Transfer + Check-in Hanok", "14:15", "transfer", "2026-11-19", "pending", "Hanok Gongsimga")];

    expect(resolveHotelDestination(context, days)).toBe("Hanok Gongsimga");
    expect(resolveHotelCheckIn(context, days)).toBeUndefined();
  });

  it("does not guess the hotel destination when the itinerary has multiple hotels and no arrival date", () => {
    const context: TravelContext = { version: 1, arrival: { location: "ORY" } };
    const days = [
      hotelActivity("Check-in Hotel A", "15:00", "hotel-a", "2026-11-19", "pending", "Hotel A"),
      hotelActivity("Check-in Hotel B", "15:00", "hotel-b", "2026-11-20", "pending", "Hotel B"),
    ];

    expect(resolveHotelDestination(context, days)).toBeUndefined();
  });

  it("uses an explicit check-in activity on the arrival date instead of duplicating the profile time", () => {
    const context: TravelContext = { ...groupContext, hotel: { ...groupContext.hotel, checkIn: "14:00" } };
    const scheduled = resolveHotelCheckIn(context, [hotelActivity("Check-in at Hotel", "15:00", "checkin", "2026-11-19")]);

    expect(scheduled).toEqual({
      time: "15:00",
      source: "itinerary",
      activityTitle: "Check-in at Hotel",
    });
  });

  it("does not mistake a combined transfer/check-in activity or another day's check-in for the policy time", () => {
    const context = { ...groupContext, hotel: { ...groupContext.hotel, checkIn: "15:00" } };
    const scheduled = resolveHotelCheckIn(context, [
      hotelActivity("Traslado + Check-in Hotel", "14:15", "transfer", "2026-11-19"),
      hotelActivity("Check-in Hotel", "13:00", "other-day", "2026-11-20"),
    ]);

    expect(scheduled).toEqual({ time: "15:00", source: "travel_context" });
  });

  it("falls back to the profile when multiple check-in activities disagree", () => {
    const context = { ...groupContext, hotel: { ...groupContext.hotel, checkIn: "15:00" } };
    const scheduled = resolveHotelCheckIn(context, [
      hotelActivity("Check-in Hotel A", "14:00", "checkin-a", "2026-11-19"),
      hotelActivity("Check-in Hotel B", "15:30", "checkin-b", "2026-11-19"),
    ]);

    expect(scheduled).toEqual({ time: "15:00", source: "travel_context" });
  });

  it("uses a single explicit itinerary check-in when the context has no arrival date", () => {
    const context: TravelContext = {
      ...groupContext,
      arrival: { location: "ORY", localTime: "14:30", timeZone: "Europe/Paris" },
    };
    const scheduled = resolveHotelCheckIn(context, [hotelActivity("Check-in Hotel", "15:00", "checkin", "2026-11-19")]);

    expect(scheduled).toMatchObject({ time: "15:00", source: "itinerary" });
  });

  it("does not select among check-ins on different dates when arrival date is unknown", () => {
    const context: TravelContext = {
      ...groupContext,
      arrival: { location: "ORY", localTime: "14:30", timeZone: "Europe/Paris" },
    };
    const scheduled = resolveHotelCheckIn(context, [
      hotelActivity("Check-in Hotel A", "15:00", "checkin-a", "2026-11-19"),
      hotelActivity("Check-in Hotel B", "15:00", "checkin-b", "2026-11-20"),
    ]);

    expect(scheduled).toMatchObject({ time: "15:00", source: "travel_context" });
  });

  it("estimates arrival after check-in in destination local time", () => {
    expect(estimateHotelArrival(groupContext, option({ durationMin: 45 }))).toMatchObject({
      arrivalDate: "2026-11-19",
      arrivalTime: "15:15",
      relationToCheckIn: "after_check_in",
      differenceMin: 15,
      timeZone: "Europe/Paris",
    });
  });

  it("estimates how long the group would wait before check-in", () => {
    expect(estimateHotelArrival(groupContext, option({ durationMin: 20 }))).toMatchObject({
      arrivalTime: "14:50",
      relationToCheckIn: "early",
      differenceMin: 10,
    });
  });

  it("handles transfers that cross midnight", () => {
    const context: TravelContext = {
      ...groupContext,
      arrival: { localDate: "2026-11-19", localTime: "23:40", timeZone: "Europe/Paris" },
    };
    expect(estimateHotelArrival(context, option({ durationMin: 35 }))).toMatchObject({
      arrivalDate: "2026-11-20",
      arrivalTime: "00:15",
      relationToCheckIn: "after_check_in",
    });
  });

  it.each([
    { localDate: "2026-03-29", localTime: "02:30", timeZone: "Europe/Paris" },
    { localDate: "2026-10-25", localTime: "02:30", timeZone: "Europe/Paris" },
    { localDate: "2026-02-30", localTime: "14:30", timeZone: "Europe/Paris" },
  ])("returns no confident estimate for an invalid or ambiguous local arrival: %o", (arrival) => {
    expect(estimateHotelArrival({ ...groupContext, arrival }, option())).toBeNull();
  });

  it("does not estimate check-in when the destination time zone is missing", () => {
    expect(estimateHotelArrival({ ...groupContext, arrival: { localDate: "2026-11-19", localTime: "14:30" } }, option())).toBeNull();
  });
});

describe("stored arrival options", () => {
  it("normalizes source data and rejects invalid prices or duplicate ids", () => {
    const base = { version: 1, travelerCount: 5 };
    const valid = option({ sourceCheckedAt: "2026-10-08T12:00:00Z", currency: "eur" });
    expect(parseTravelContext({ ...base, arrivalOptions: [valid] })?.arrivalOptions?.[0]).toMatchObject({
      currency: "EUR",
      sourceCheckedAt: "2026-10-08T12:00:00.000Z",
    });
    expect(parseTravelContext({ ...base, arrivalOptions: [{ ...valid, amount: -1 }] })).toBeNull();
    expect(parseTravelContext({ ...base, arrivalOptions: [valid, valid] })).toBeNull();
    expect(parseTravelContext({ ...base, arrivalOptions: [{ ...valid, priceBasis: "per_vehicle" }] })).toBeNull();
    expect(parseTravelContext({ ...base, arrivalOptions: [{ ...valid, currency: "EURR" }] })).toBeNull();
    expect(parseTravelContext({ ...base, arrivalOptions: [{ ...valid, currency: "ZZZ" }] })).toBeNull();
    expect(parseTravelContext({ ...base, arrivalOptions: [{ ...valid, currency: "JPY", amount: 3.5 }] })).toBeNull();
    expect(parseTravelContext({ ...base, arrivalOptions: [{ ...valid, currency: "KWD", amount: 0.333 }] })).not.toBeNull();
  });
});
