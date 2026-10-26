import { describe, it, expect } from "vitest";
import {
  computeCompletionCelebration,
  filterActivitiesByMapStatus,
  findNextPendingDayId,
  isDayComplete,
  isTripComplete,
} from "@/lib/trip-progress";
import type { Activity, ActivityState, TripDay, TripPlan } from "@/lib/types";

function activity(id: string, state: ActivityState = "pending"): Activity {
  return {
    id,
    title: `Activity ${id}`,
    time: "10:00",
    durationMin: 60,
    category: "sightseeing",
    priority: "medium",
    state,
    sort_order: 0,
  } as Activity;
}

function day(id: string, activities: Activity[]): TripDay {
  return { id, date: "2026-10-26", city: "Tokyo", label: id, activities, userId: "u" };
}

function trip(days: TripDay[]): TripPlan {
  return { id: "t", name: "Trip", days, criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [] };
}

describe("isDayComplete", () => {
  it("is true only when every activity is completed", () => {
    expect(isDayComplete(day("d", [activity("a", "completed"), activity("b", "completed")]))).toBe(true);
    expect(isDayComplete(day("d", [activity("a", "completed"), activity("b")]))).toBe(false);
  });

  it("never treats an empty day as completed", () => {
    expect(isDayComplete(day("d", []))).toBe(false);
  });
});

describe("isTripComplete", () => {
  it("ignores empty days and requires every activity completed", () => {
    expect(isTripComplete(trip([day("d1", [activity("a", "completed")]), day("d2", [])]))).toBe(true);
    expect(isTripComplete(trip([day("d1", [activity("a", "completed")]), day("d2", [activity("b")])]))).toBe(false);
  });

  it("is false for a trip without activities", () => {
    expect(isTripComplete(trip([day("d1", [])]))).toBe(false);
  });
});

describe("findNextPendingDayId", () => {
  it("skips empty and completed days instead of adding one day", () => {
    const days = [
      day("d1", [activity("a")]),
      day("d2", []),
      day("d3", [activity("b", "completed")]),
      day("d4", [activity("c")]),
    ];
    expect(findNextPendingDayId(days, "d1")).toBe("d4");
  });

  it("wraps around to earlier pending days", () => {
    const days = [day("d1", [activity("a")]), day("d2", [activity("b", "completed")])];
    expect(findNextPendingDayId(days, "d2")).toBe("d1");
  });

  it("returns undefined when no other day has pending activities", () => {
    const days = [day("d1", [activity("a")]), day("d2", [activity("b", "completed")])];
    expect(findNextPendingDayId(days, "d1")).toBeUndefined();
  });
});

describe("computeCompletionCelebration", () => {
  it("returns a single activity celebration while the day still has pending work", () => {
    const t = trip([day("d1", [activity("a"), activity("b")])]);
    expect(computeCompletionCelebration(t, "d1", "a")).toEqual({ tier: 1 });
  });

  it("returns only the day celebration for the last pending activity of the day", () => {
    const t = trip([
      day("d1", [activity("a", "completed"), activity("b")]),
      day("d2", []),
      day("d3", [activity("c")]),
    ]);
    expect(computeCompletionCelebration(t, "d1", "b")).toEqual({ tier: 2, nextDayId: "d3" });
  });

  it("returns only the trip celebration for the last pending activity of the trip", () => {
    const t = trip([
      day("d1", [activity("a", "completed")]),
      day("d2", [activity("b", "completed"), activity("c")]),
    ]);
    expect(computeCompletionCelebration(t, "d2", "c")).toEqual({ tier: 3 });
  });

  it("does not celebrate an activity that is already completed", () => {
    const t = trip([day("d1", [activity("a", "completed")])]);
    expect(computeCompletionCelebration(t, "d1", "a")).toBeNull();
  });

  it("does not celebrate unknown days or activities", () => {
    const t = trip([day("d1", [activity("a")])]);
    expect(computeCompletionCelebration(t, "missing", "a")).toBeNull();
    expect(computeCompletionCelebration(t, "d1", "missing")).toBeNull();
  });
});

describe("filterActivitiesByMapStatus", () => {
  const items = [activity("a"), activity("b", "completed"), activity("c", "skipped")];

  it("shows pending and completed activities with the all filter", () => {
    expect(filterActivitiesByMapStatus(items, "all").map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("shows only not-completed activities with the pending filter", () => {
    expect(filterActivitiesByMapStatus(items, "pending").map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("shows only completed activities with the completed filter", () => {
    expect(filterActivitiesByMapStatus(items, "completed").map((a) => a.id)).toEqual(["b"]);
  });

  it("never mutates the activities it filters", () => {
    const snapshot = JSON.stringify(items);
    filterActivitiesByMapStatus(items, "completed");
    filterActivitiesByMapStatus(items, "pending");
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
