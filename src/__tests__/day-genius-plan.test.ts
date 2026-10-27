import { describe, expect, it } from "vitest";
import { buildGeniusContext, type GeniusContext } from "@/lib/day-genius/context";
import { geniusConflicts, validateGeniusPlan } from "@/lib/day-genius/validate";
import type { Activity, BookingDetails, TripDay } from "@/lib/types";

function booking(partial: Partial<BookingDetails> & Pick<BookingDetails, "type" | "role">): BookingDetails {
  return { version: 1, groupId: `g-${partial.type}`, title: partial.type, fieldStatus: {}, ...partial };
}

function activity(id: string, dayId: string, time: string, durationMin: number, extra: Partial<Activity> = {}): Activity {
  return {
    id,
    dayId,
    tripId: "trip",
    userId: "user",
    city: "La Palma",
    title: id,
    time,
    durationMin,
    category: "sightseeing",
    priority: "medium",
    state: "pending",
    sort_order: 0,
    origin: "manual",
    ...extra,
  };
}

function day(id: string, date: string, activities: Activity[]): TripDay {
  return { id, date, city: "La Palma", label: id, activities, userId: "user" };
}

/** The user's case: the first activity ran long and the rest of the day no longer fits. */
function overrunTrip(): TripDay[] {
  return [
    day("d1", "2026-11-01", [activity("done", "d1", "10:00", 60, { state: "completed" })]),
    day("d2", "2026-11-02", [
      activity("hike", "d2", "09:00", 120, { title: "Caldera de Taburiente", location: "Caldera de Taburiente" }),
      activity("lunch", "d2", "12:00", 60, { title: "Almuerzo", category: "food", location: "Los Llanos" }),
      activity("beach", "d2", "14:00", 120, { title: "Playa de Puerto Naos", location: "Puerto Naos" }),
      activity("old", "d2", "08:00", 30, { title: "Café", state: "completed" }),
      activity("car", "d2", "19:00", 0, { origin: "booking", category: "transport", booking: booking({ type: "car_rental", role: "dropoff" }) }),
    ]),
    day("d3", "2026-11-03", [activity("museum", "d3", "10:00", 90, { title: "Museo Insular" })]),
  ];
}

const coords = {
  hike: { lat: 28.7167, lng: -17.8667 },
  lunch: { lat: 28.6585, lng: -17.9182 },
  beach: { lat: 28.6162, lng: -17.9213 },
};

function todayContext(now = "12:20"): GeniusContext {
  const result = buildGeniusContext({ days: overrunTrip(), dayId: "d2", now: { date: "2026-11-02", time: now }, coords });
  if (!result.ok) throw new Error(result.reason);
  return result.context;
}

describe("buildGeniusContext", () => {
  it("plans today from the current time and assumes the first unfinished activity is still in progress", () => {
    const context = todayContext();
    expect(context).toMatchObject({ date: "2026-11-02", mode: "today", now: "12:20", windowStart: "12:20", dayEnd: "22:00" });
    // The hike started at 09:00 and is not checked off: the user is still there, so it runs until now.
    expect(context.fixed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hike", kind: "ongoing", start: "09:00", end: "12:20" }),
      // Car drop-off keeps its handover margins on both sides.
      expect.objectContaining({ id: "car", kind: "booking", start: "18:30", end: "19:30" }),
    ]));
    expect(context.movable.map((m) => [m.id, m.status])).toEqual([["lunch", "overdue"], ["beach", "upcoming"]]);
    // Completed activities are history, not part of the plan.
    expect(JSON.stringify(context)).not.toContain('"old"');
  });

  it("rounds the current time up to the next 5 minutes", () => {
    expect(todayContext("12:21").windowStart).toBe("12:25");
  });

  it("plans a future day from the morning without a current time", () => {
    const result = buildGeniusContext({ days: overrunTrip(), dayId: "d2", now: { date: "2026-11-01", time: "20:00" } });
    expect(result.ok && result.context).toMatchObject({ mode: "future", windowStart: "08:00" });
    expect(result.ok && result.context.now).toBeUndefined();
    expect(result.ok && result.context.fixed.some((f) => f.kind === "ongoing")).toBe(false);
  });

  it("estimates travel minutes only between places with coordinates, walking or riding by distance", () => {
    const context = todayContext();
    const hikeToLunch = context.travel.find((t) => t.from === "hike" && t.to === "lunch");
    expect(hikeToLunch).toMatchObject({ mode: "ride" });
    expect(hikeToLunch!.km).toBeGreaterThan(6);
    expect(hikeToLunch!.minutes).toBeGreaterThan(15);
    expect(context.travel.every((t) => t.from !== "car" && t.to !== "car")).toBe(true);

    const near = buildGeniusContext({
      days: overrunTrip(),
      dayId: "d2",
      now: { date: "2026-11-02", time: "12:20" },
      coords: { lunch: { lat: 28.6585, lng: -17.9182 }, beach: { lat: 28.6620, lng: -17.9182 } },
    });
    expect(near.ok && near.context.travel).toEqual([expect.objectContaining({ from: "lunch", to: "beach", mode: "walk" })]);
  });

  it("offers only later trip days, with their free windows, as places to move things", () => {
    const context = todayContext();
    expect(context.otherDays.map((d) => d.date)).toEqual(["2026-11-03"]);
    expect(context.otherDays[0].freeWindows).toEqual([{ start: "09:00", end: "10:00" }, { start: "11:45", end: "21:30" }]);
  });

  it("blocks the next day's arrival of an overnight flight that leaves today", () => {
    const days = overrunTrip();
    days[1].activities.push(activity("redeye", "d2", "22:00", 540, {
      origin: "booking",
      category: "transport",
      booking: booking({ type: "flight", role: "single", end: { date: "2026-11-03", time: "09:30" } }),
    }));
    const result = buildGeniusContext({ days, dayId: "d2", now: { date: "2026-11-02", time: "12:20" } });
    if (!result.ok) throw new Error(result.reason);
    // Landing 09:30 + 60 min arrival margin blocks the morning: the 09:00–10:00 gap is gone.
    expect(result.context.otherDays[0].freeWindows).toEqual([{ start: "11:45", end: "21:30" }]);
    const plan = validateGeniusPlan(result.context, { move_to_other_day: [{ id: "lunch", date: "2026-11-03", time: "09:00", reason: "x" }] });
    expect(plan.rejected).toEqual([{ ref: "lunch", reason: "outside_free_time" }]);
  });

  it("explains when there is nothing to reorganize", () => {
    const past = buildGeniusContext({ days: overrunTrip(), dayId: "d2", now: { date: "2026-11-05", time: "10:00" } });
    expect(past).toEqual({ ok: false, reason: "past_day" });

    const late = buildGeniusContext({ days: overrunTrip(), dayId: "d2", now: { date: "2026-11-02", time: "23:58" } });
    expect(late).toEqual({ ok: false, reason: "day_over" });

    const empty = buildGeniusContext({ days: overrunTrip(), dayId: "d1", now: { date: "2026-11-01", time: "09:00" } });
    expect(empty).toEqual({ ok: false, reason: "nothing_to_reorganize" });
  });
});

describe("validateGeniusPlan", () => {
  it("accepts a valid reschedule and drops entries that break the rules", () => {
    const context = todayContext();
    const result = validateGeniusPlan(context, {
      summary: "Retrasamos el almuerzo",
      schedule: [
        { id: "lunch", time: "13:00", duration_minutes: 60, reason: "Llegás tarde desde la Caldera" },
        { id: "beach", time: "11:00", duration_minutes: 60, reason: "antes de ahora" },
        { id: "ghost", time: "15:00", duration_minutes: 60, reason: "no existe" },
      ],
    });
    expect(result.summary).toBe("Retrasamos el almuerzo");
    expect(result.changes).toEqual([
      expect.objectContaining({ kind: "reschedule", activityId: "lunch", from: { time: "12:00", durationMin: 60 }, to: { time: "13:00", durationMin: 60 }, reason: "Llegás tarde desde la Caldera" }),
    ]);
    expect(result.rejected).toEqual(expect.arrayContaining([
      { ref: "beach", reason: "before_window" },
      { ref: "ghost", reason: "unknown_id" },
    ]));
  });

  it("never schedules on top of a booking or past the end of the day", () => {
    const context = todayContext();
    const result = validateGeniusPlan(context, {
      schedule: [
        { id: "lunch", time: "18:00", duration_minutes: 60, reason: "x" },
        { id: "beach", time: "21:30", duration_minutes: 120, reason: "y" },
      ],
    });
    expect(result.changes).toEqual([]);
    expect(result.rejected).toEqual([{ ref: "beach", reason: "after_day_end" }, { ref: "lunch", reason: "overlap" }]);
  });

  it("keeps unmentioned activities in their slot", () => {
    const context = todayContext();
    const result = validateGeniusPlan(context, { schedule: [{ id: "lunch", time: "14:30", duration_minutes: 60, reason: "x" }] });
    // The beach (14:00–16:00) was not mentioned, so it still occupies that time.
    expect(result.changes).toEqual([]);
    expect(result.rejected).toEqual([{ ref: "lunch", reason: "overlap" }]);
  });

  it("does not report unchanged entries as changes", () => {
    const context = todayContext();
    const result = validateGeniusPlan(context, { schedule: [{ id: "beach", time: "14:00", duration_minutes: 120, reason: "igual" }] });
    expect(result.changes).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("moves an activity to a later day only inside that day's free time", () => {
    const context = todayContext();
    const ok = validateGeniusPlan(context, { move_to_other_day: [{ id: "beach", date: "2026-11-03", time: "15:00", reason: "Llueve hoy" }] });
    expect(ok.changes).toEqual([
      expect.objectContaining({ kind: "move_day", activityId: "beach", fromTime: "14:00", toDate: "2026-11-03", toTime: "15:00", reason: "Llueve hoy" }),
    ]);

    const bad = validateGeniusPlan(context, {
      move_to_other_day: [
        { id: "beach", date: "2026-11-03", time: "10:30", reason: "pisa el museo" },
        { id: "lunch", date: "2026-11-01", time: "13:00", reason: "día pasado" },
      ],
    });
    expect(bad.changes).toEqual([]);
    expect(bad.rejected).toEqual([{ ref: "beach", reason: "outside_free_time" }, { ref: "lunch", reason: "invalid_day" }]);
  });

  it("adds at most three valid suggestions in free time, keeping what they replace", () => {
    const context = todayContext();
    const suggestion = (time: string, extra: Record<string, unknown> = {}) => ({
      title: `Museo ${time}`, category: "sightseeing", location: "Santa Cruz", time, duration_minutes: 60, notes: "Bajo techo", reason: "Lluvia", ...extra,
    });
    const result = validateGeniusPlan(context, {
      move_to_other_day: [{ id: "beach", date: "2026-11-03", time: "15:00", reason: "Llueve" }],
      suggestions: [
        suggestion("14:00", { replaces_id: "beach" }),
        suggestion("15:30", { category: "spa" }),
        suggestion("16:00"),
        suggestion("17:00"),
        suggestion("20:00"),
      ],
    });
    const adds = result.changes.filter((c) => c.kind === "add");
    expect(adds).toHaveLength(3);
    expect(adds[0]).toMatchObject({ replacesId: "beach", suggestion: { title: "Museo 14:00", time: "14:00", durationMin: 60, category: "sightseeing" } });
    expect(result.rejected).toEqual(expect.arrayContaining([{ ref: "Museo 15:30", reason: "invalid_category" }, { ref: "Museo 20:00", reason: "too_many" }]));
  });

  it("reports activities that no longer fit without deleting them", () => {
    const context = todayContext();
    const result = validateGeniusPlan(context, { unplaced: [{ id: "beach", reason: "No hay tiempo" }, { id: "nope", reason: "x" }] });
    expect(result.changes).toEqual([expect.objectContaining({ kind: "unplaced", activityId: "beach", reason: "No hay tiempo" })]);
  });

  it("never lets the model change a booking or the activity in progress", () => {
    const context = todayContext();
    const result = validateGeniusPlan(context, {
      schedule: [{ id: "car", time: "20:00", duration_minutes: 30, reason: "x" }, { id: "hike", time: "13:00", duration_minutes: 60, reason: "x" }],
      move_to_other_day: [{ id: "car", date: "2026-11-03", time: "15:00", reason: "x" }],
      unplaced: [{ id: "hike", reason: "x" }],
    });
    expect(result.changes).toEqual([]);
    expect(result.rejected.every((r) => r.reason === "unknown_id")).toBe(true);
    expect(result.rejected).toHaveLength(4);
  });

  it("tolerates malformed model output", () => {
    const context = todayContext();
    expect(validateGeniusPlan(context, null)).toEqual({ summary: "", changes: [], rejected: [] });
    expect(validateGeniusPlan(context, { schedule: "nope", suggestions: [null, 3] }).changes).toEqual([]);
  });
});

describe("geniusConflicts", () => {
  it("flags accepted changes that collide once the user unchecks another one", () => {
    const context = todayContext();
    const { changes } = validateGeniusPlan(context, {
      schedule: [{ id: "lunch", time: "14:30", duration_minutes: 60, reason: "x" }],
      move_to_other_day: [{ id: "beach", date: "2026-11-03", time: "15:00", reason: "Llueve" }],
    });
    expect(changes.map((c) => c.kind)).toEqual(["reschedule", "move_day"]);
    const [reschedule, move] = changes;

    expect(geniusConflicts(context, changes, new Set([reschedule.key, move.key]))).toEqual(new Set());
    // Keeping the beach today brings back its 14:00–16:00 slot, which the new lunch time overlaps.
    expect(geniusConflicts(context, changes, new Set([reschedule.key]))).toEqual(new Set([reschedule.key]));
  });
});
