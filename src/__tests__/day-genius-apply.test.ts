import { describe, expect, it } from "vitest";
import { planToOps } from "@/lib/day-genius/apply";
import { tripTimeZone } from "@/lib/day-genius/context";
import type { GeniusChange } from "@/lib/day-genius/validate";
import type { Activity, TripDay } from "@/lib/types";

function activity(id: string, dayId: string, time: string, durationMin: number, extra: Partial<Activity> = {}): Activity {
  return {
    id, dayId, tripId: "trip", userId: "user", city: "La Palma", title: id, time, durationMin,
    category: "sightseeing", priority: "medium", state: "pending", sort_order: 0, origin: "manual", ...extra,
  };
}

const days: TripDay[] = [
  {
    id: "d2", date: "2026-11-02", city: "La Palma", label: "", userId: "user",
    activities: [
      activity("hike", "d2", "09:00", 120, { sort_order: 0 }),
      activity("lunch", "d2", "12:00", 60, { sort_order: 1, notes: "Reservar mesa", reservationUrl: "https://example.test/r" }),
      activity("park", "d2", "14:00", 120, { sort_order: 2 }),
    ],
  },
  { id: "d3", date: "2026-11-03", city: "Santa Cruz", label: "", userId: "user", activities: [activity("roque", "d3", "10:00", 180, { sort_order: 0 })] },
];

const changes: GeniusChange[] = [
  { key: "r:lunch", kind: "reschedule", activityId: "lunch", title: "lunch", from: { time: "12:00", durationMin: 60 }, to: { time: "13:00", durationMin: 75 }, reason: "" },
  { key: "a:0", kind: "add", suggestion: { title: "Museo Insular", category: "sightseeing", location: "Santa Cruz", time: "15:00", durationMin: 90, notes: "Verificá el horario" }, replacesId: "park", reason: "Lluvia" },
  { key: "m:park", kind: "move_day", activityId: "park", title: "park", fromTime: "14:00", toDate: "2026-11-03", toTime: "08:30", reason: "Lluvia" },
  { key: "u:x", kind: "unplaced", activityId: "hike", title: "hike", reason: "" },
];

describe("planToOps", () => {
  it("turns accepted changes into field updates and new suggested activities, never deletions", () => {
    const ops = planToOps({ days, dayId: "d2", changes, accepted: new Set(["r:lunch", "a:0", "m:park", "u:x"]) });

    expect(ops.updates).toEqual([
      { activityId: "lunch", patch: { time: "13:00", durationMin: 75 } },
      // Moved before the Roque visit on the next day: it goes first there.
      { activityId: "park", patch: { time: "08:30", dayId: "d3", sort_order: 0 } },
      { activityId: "roque", patch: { sort_order: 1 } },
    ]);
    expect(ops.additions).toEqual([
      expect.objectContaining({
        dayId: "d2", city: "La Palma", title: "Museo Insular", category: "sightseeing", location: "Santa Cruz",
        time: "15:00", durationMin: 90, notes: "Verificá el horario", origin: "suggested", state: "pending", priority: "medium", sort_order: 2,
      }),
    ]);
  });

  it("ignores unchecked changes", () => {
    const ops = planToOps({ days, dayId: "d2", changes, accepted: new Set(["r:lunch"]) });
    expect(ops.updates).toEqual([{ activityId: "lunch", patch: { time: "13:00", durationMin: 75 } }]);
    expect(ops.additions).toEqual([]);
  });

  it("only sends the fields that change, so notes, links and files stay untouched", () => {
    const ops = planToOps({ days, dayId: "d2", changes, accepted: new Set(["r:lunch"]) });
    expect(Object.keys(ops.updates[0].patch)).toEqual(["time", "durationMin"]);
  });
});

describe("tripTimeZone", () => {
  it("prefers the travel context, then booking time zones, then the device", () => {
    expect(tripTimeZone({ travelContext: { version: 1, arrival: { timeZone: "Atlantic/Canary" } }, days: [] }, "Europe/Madrid")).toBe("Atlantic/Canary");
    const withBooking: TripDay[] = [{
      ...days[0],
      activities: [activity("f", "d2", "10:00", 60, {
        origin: "booking",
        booking: { version: 1, type: "flight", role: "single", groupId: "g", title: "f", fieldStatus: {}, end: { date: "2026-11-02", time: "12:00", timeZone: "Atlantic/Canary" } },
      })],
    }];
    expect(tripTimeZone({ days: withBooking }, "Europe/Madrid")).toBe("Atlantic/Canary");
    expect(tripTimeZone({ travelContext: { version: 1, arrival: { timeZone: "Not/AZone" } }, days: [] }, "Europe/Madrid")).toBe("Europe/Madrid");
  });
});
