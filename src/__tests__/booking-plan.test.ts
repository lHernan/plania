import { describe, expect, it } from "vitest";
import {
  assessFeasibility,
  buildPlanningContext,
  proposalsFromImporter,
  validateProposals,
  type Proposal,
} from "@/lib/bookings/plan";
import type { Activity, BookingDetails, TripDay } from "@/lib/types";

function booking(partial: Partial<BookingDetails> & Pick<BookingDetails, "type" | "role">): BookingDetails {
  return { version: 1, groupId: `g-${partial.type}`, title: partial.type, fieldStatus: {}, ...partial };
}

let seq = 0;
function activity(dayId: string, time: string, durationMin: number, extra: Partial<Activity> = {}): Activity {
  seq += 1;
  return {
    id: `a${seq}`,
    dayId,
    tripId: "trip",
    userId: "user",
    city: "La Palma",
    title: `Activity ${seq}`,
    time,
    durationMin,
    category: "other",
    priority: "medium",
    state: "pending",
    sort_order: seq,
    origin: "manual",
    ...extra,
  };
}

function day(id: string, date: string, activities: Activity[]): TripDay {
  return { id, date, city: "La Palma", label: id, activities, userId: "user" };
}

/** La Palma-like trip: outbound Madrid -> Canary flight, car rental, Airbnb, return flight. */
function laPalmaDays(): TripDay[] {
  return [
    // Given out of order on purpose: the context must sort by date.
    day("d4", "2026-11-04", [
      activity("d4", "11:00", 0, { origin: "booking", category: "hotel", booking: booking({ type: "lodging", role: "check_out", end: { date: "2026-11-04", time: "11:00" } }) }),
      activity("d4", "13:00", 0, { origin: "booking", category: "transport", booking: booking({ type: "car_rental", role: "dropoff", end: { date: "2026-11-04", time: "13:00" } }) }),
      activity("d4", "15:00", 165, {
        origin: "booking",
        category: "transport",
        location: "SPC airport",
        booking: booking({
          type: "flight",
          role: "single",
          start: { date: "2026-11-04", time: "15:00", timeZone: "Atlantic/Canary" },
          end: { date: "2026-11-04", time: "18:45", timeZone: "Europe/Madrid" },
        }),
      }),
    ]),
    day("d1", "2026-11-01", [
      activity("d1", "10:00", 170, {
        origin: "booking",
        category: "transport",
        booking: booking({
          type: "flight",
          role: "single",
          start: { date: "2026-11-01", time: "10:00", timeZone: "Europe/Madrid" },
          end: { date: "2026-11-01", time: "11:50", timeZone: "Atlantic/Canary" },
        }),
      }),
      activity("d1", "12:30", 0, { origin: "booking", category: "transport", booking: booking({ type: "car_rental", role: "pickup", start: { date: "2026-11-01", time: "12:30" } }) }),
      activity("d1", "16:00", 0, { origin: "booking", category: "hotel", booking: booking({ type: "lodging", role: "check_in", start: { date: "2026-11-01", time: "16:00" } }) }),
    ]),
    day("d2", "2026-11-02", []),
    day("d3", "2026-11-03", [activity("d3", "10:00", 120, { title: "Roque de los Muchachos", state: "completed" })]),
  ];
}

function laPalmaContext(density: "light" | "balanced" | "full" = "balanced") {
  return buildPlanningContext({ tripName: "La Palma", startDate: "2026-11-01", endDate: "2026-11-04", days: laPalmaDays(), density });
}

function proposal(date: string, time: string, durationMin: number, title = `P ${date} ${time}`): Proposal {
  return { title, category: "sightseeing", date, time, durationMin };
}

describe("buildPlanningContext", () => {
  it("orders days by date and keeps trip metadata", () => {
    const context = laPalmaContext();
    expect(context.days.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(context).toMatchObject({ tripName: "La Palma", startDate: "2026-11-01", endDate: "2026-11-04", density: "balanced" });
  });

  it("blocks the arrival day around the flight, car pickup and check-in", () => {
    const [arrival] = laPalmaContext().days;
    expect(arrival.anchors.map(({ kind, bookingType, role, start, end }) => ({ kind, bookingType, role, start, end }))).toEqual([
      { kind: "booking", bookingType: "flight", role: "single", start: "08:00", end: "12:50" },
      { kind: "booking", bookingType: "car_rental", role: "pickup", start: "12:00", end: "13:00" },
      { kind: "booking", bookingType: "lodging", role: "check_in", start: "16:00", end: "16:30" },
    ]);
    expect(arrival.freeWindows).toEqual([{ start: "13:00", end: "16:00" }, { start: "16:30", end: "21:30" }]);
  });

  it("treats regular activities as anchors with a buffer, completed ones included", () => {
    const day3 = laPalmaContext().days[2];
    expect(day3.anchors).toEqual([expect.objectContaining({ kind: "activity", title: "Roque de los Muchachos", start: "10:00", end: "12:15" })]);
    expect(day3.freeWindows).toEqual([{ start: "09:00", end: "10:00" }, { start: "12:15", end: "21:30" }]);
    expect(laPalmaContext().days[1].freeWindows).toEqual([{ start: "09:00", end: "21:30" }]);
  });

  it("blocks check-out, car drop-off and the return flight on the last day", () => {
    const last = laPalmaContext().days[3];
    expect(last.anchors.map(({ start, end }) => [start, end])).toEqual([["10:30", "11:00"], ["12:30", "13:30"], ["13:00", "19:45"]]);
    expect(last.freeWindows).toEqual([{ start: "09:00", end: "10:30" }, { start: "11:00", end: "12:30" }, { start: "19:45", end: "21:30" }]);
  });

  it("drops free windows shorter than 60 minutes and honors custom day bounds", () => {
    const context = buildPlanningContext({
      tripName: "T",
      density: "balanced",
      dayStart: "08:00",
      dayEnd: "20:00",
      days: [day("x", "2026-11-05", [activity("x", "08:30", 60), activity("x", "10:30", 600)])],
    });
    // 08:00-08:30 (30 min) and 09:45-10:30 (45 min) are dropped; 10:30 + 600 + 15 passes the day end.
    expect(context.days[0].freeWindows).toEqual([]);
  });

  it("caps suggestions by density and halves them on flight days", () => {
    expect(laPalmaContext("light").days.map((d) => d.maxSuggestions)).toEqual([1, 2, 2, 1]);
    expect(laPalmaContext("balanced").days.map((d) => d.maxSuggestions)).toEqual([1, 3, 3, 1]);
    expect(laPalmaContext("full").days.map((d) => d.maxSuggestions)).toEqual([2, 5, 5, 2]);
  });

  it("adds an arrival anchor on the next day for an overnight flight", () => {
    const context = buildPlanningContext({
      tripName: "T",
      density: "balanced",
      days: [
        day("a", "2026-11-01", [activity("a", "22:00", 600, { origin: "booking", booking: booking({ type: "flight", role: "single", end: { date: "2026-11-02", time: "08:00" } }) })]),
        day("b", "2026-11-02", []),
      ],
    });
    expect(context.days[0].freeWindows).toEqual([{ start: "09:00", end: "20:00" }]);
    expect(context.days[1].anchors).toEqual([expect.objectContaining({ bookingType: "flight", start: "00:00", end: "09:00" })]);
    expect(context.days[1].freeWindows).toEqual([{ start: "09:00", end: "21:30" }]);
    expect(context.days.map((d) => d.maxSuggestions)).toEqual([1, 1]);
  });

  it("never mutates the trip days", () => {
    const days = laPalmaDays();
    const before = structuredClone(days);
    buildPlanningContext({ tripName: "La Palma", days, density: "full" });
    expect(days).toEqual(before);
  });
});

describe("validateProposals", () => {
  it("accepts proposals fully inside a free window", () => {
    const context = laPalmaContext("full");
    const ok = proposal("2026-11-02", "10:00", 90);
    expect(validateProposals([ok], context)).toEqual({ valid: [ok], conflicts: [] });
  });

  it("rejects proposals overlapping anchors or their margins", () => {
    const context = laPalmaContext("full");
    const duringFlightMargin = proposal("2026-11-01", "12:00", 30); // arrival margin lasts until 12:50
    const duringPickup = proposal("2026-11-01", "12:40", 60);
    const crossesCheckIn = proposal("2026-11-01", "15:30", 60);
    const beforeReturnFlight = proposal("2026-11-04", "12:00", 60); // drop-off margin starts at 12:30
    const result = validateProposals([duringFlightMargin, duringPickup, crossesCheckIn, beforeReturnFlight], context);
    expect(result.valid).toEqual([]);
    expect(result.conflicts.map((c) => c.reason)).toEqual(Array(4).fill("outside_free_window"));
  });

  it("rejects proposals outside the trip and with invalid times", () => {
    const context = laPalmaContext("full");
    const result = validateProposals([
      proposal("2026-10-31", "10:00", 60),
      proposal("2026-11-02", "25:00", 60),
      proposal("2026-11-02", "9:00", 60),
      proposal("2026-11-02", "10:00", 0),
    ], context);
    expect(result.valid).toEqual([]);
    expect(result.conflicts.map((c) => c.reason)).toEqual(["outside_trip", "invalid_time", "invalid_time", "invalid_time"]);
  });

  it("rejects proposals overlapping an earlier accepted proposal", () => {
    const context = laPalmaContext("full");
    const first = proposal("2026-11-02", "10:00", 120);
    const overlapping = proposal("2026-11-02", "11:00", 60);
    const result = validateProposals([overlapping, first], context);
    expect(result.valid).toEqual([first]);
    expect(result.conflicts).toEqual([{ proposal: overlapping, reason: "outside_free_window" }]);
  });

  it("enforces the per-day limit in time order", () => {
    const context = laPalmaContext("balanced"); // the flight day allows 1
    const late = proposal("2026-11-01", "18:00", 60);
    const early = proposal("2026-11-01", "13:30", 60);
    const result = validateProposals([late, early], context);
    expect(result.valid).toEqual([early]);
    expect(result.conflicts).toEqual([{ proposal: late, reason: "over_day_limit" }]);
  });

  it("never mutates proposals or anchors", () => {
    const context = laPalmaContext("full");
    const proposals = [proposal("2026-11-02", "10:00", 60), proposal("2026-11-01", "12:00", 60)];
    const contextBefore = structuredClone(context);
    const proposalsBefore = structuredClone(proposals);
    validateProposals(proposals, context);
    expect(context).toEqual(contextBefore);
    expect(proposals).toEqual(proposalsBefore);
  });
});

describe("assessFeasibility", () => {
  it("reports a feasible trip and its blocked days", () => {
    const context = buildPlanningContext({
      tripName: "T",
      density: "balanced",
      days: [day("a", "2026-11-01", [activity("a", "09:00", 750)]), day("b", "2026-11-02", [])],
    });
    expect(assessFeasibility(context)).toEqual({ feasible: true, blockedDays: ["2026-11-01"], alternatives: ["skip_blocked_days"] });
    expect(assessFeasibility(laPalmaContext())).toEqual({ feasible: true, blockedDays: [], alternatives: [] });
  });

  it("reports an infeasible trip when every day is blocked, with alternatives", () => {
    const context = buildPlanningContext({
      tripName: "T",
      density: "full",
      days: [
        day("a", "2026-11-01", [activity("a", "08:00", 900)]),
        day("b", "2026-11-02", [activity("b", "09:00", 750)]),
      ],
    });
    expect(assessFeasibility(context)).toEqual({
      feasible: false,
      blockedDays: ["2026-11-01", "2026-11-02"],
      alternatives: ["free_up_time"],
    });
  });
});

describe("proposalsFromImporter", () => {
  it("maps importer activities and drops malformed ones", () => {
    const raw = {
      activities: [
        { title: "Lunch", category: "food", location: "Port", date: "2026-11-02", time: "13:30", duration_minutes: 75, notes: "Verify opening hours", time_confidence: 0.8, time_inferred: true },
        { title: "Walk", category: "sightseeing", date: "2026-11-02", time: "17:00", duration_minutes: 60 },
        { title: "No date", category: "food", time: "13:30", duration_minutes: 60 },
        { title: "No time", category: "food", date: "2026-11-02", duration_minutes: 60 },
        { title: "Bad time", category: "food", date: "2026-11-02", time: "noon", duration_minutes: 60 },
        { title: "No duration", category: "food", date: "2026-11-02", time: "13:30" },
        { title: "", category: "food", date: "2026-11-02", time: "13:30", duration_minutes: 60 },
        "garbage",
        null,
      ],
    };
    expect(proposalsFromImporter(raw)).toEqual([
      { title: "Lunch", category: "food", location: "Port", date: "2026-11-02", time: "13:30", durationMin: 75, notes: "Verify opening hours" },
      { title: "Walk", category: "sightseeing", date: "2026-11-02", time: "17:00", durationMin: 60 },
    ]);
  });

  it("returns an empty list for unexpected shapes", () => {
    expect(proposalsFromImporter(null)).toEqual([]);
    expect(proposalsFromImporter({})).toEqual([]);
    expect(proposalsFromImporter({ activities: "x" })).toEqual([]);
  });
});
