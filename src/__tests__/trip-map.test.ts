import { describe, expect, it } from "vitest";
import { makeActivity } from "./helpers/dom";
import {
  DAY_COLORS,
  aggregateTripActivities,
  buildDayRouteLegs,
  dayColor,
} from "@/lib/trip-map";

describe("dayColor", () => {
  it("gives consecutive days distinct colors", () => {
    const colors = DAY_COLORS.map((_, i) => dayColor(i));
    expect(new Set(colors).size).toBe(DAY_COLORS.length);
  });

  it("cycles through the palette for long trips", () => {
    expect(dayColor(DAY_COLORS.length)).toBe(dayColor(0));
    expect(dayColor(DAY_COLORS.length + 2)).toBe(dayColor(2));
  });
});

describe("aggregateTripActivities", () => {
  const days = [
    {
      id: "d1",
      city: "Tokyo",
      activities: [
        makeActivity("b", { time: "11:00" }),
        makeActivity("a", { time: "09:00" }),
      ],
    },
    { id: "d2", city: "Kyoto", activities: [makeActivity("c", { time: "08:00" })] },
  ];

  it("keeps every activity with its day index and that day's city", () => {
    const entries = aggregateTripActivities(days);
    expect(entries.map((e) => [e.activity.id, e.dayId, e.dayIndex, e.city])).toEqual([
      ["a", "d1", 0, "Tokyo"],
      ["b", "d1", 0, "Tokyo"],
      ["c", "d2", 1, "Kyoto"],
    ]);
  });

  it("numbers stops by itinerary order within each day", () => {
    expect(aggregateTripActivities(days).map((e) => e.order)).toEqual([1, 2, 1]);
  });

  it("breaks time ties by sort order", () => {
    const entries = aggregateTripActivities([
      {
        id: "d1",
        city: "Tokyo",
        activities: [
          makeActivity("y", { time: "10:00", sort_order: 2 }),
          makeActivity("x", { time: "10:00", sort_order: 1 }),
        ],
      },
    ]);
    expect(entries.map((e) => e.activity.id)).toEqual(["x", "y"]);
  });

  it("never mutates the input activities", () => {
    const input = [makeActivity("b", { time: "11:00" }), makeActivity("a", { time: "09:00" })];
    aggregateTripActivities([{ id: "d1", city: "Tokyo", activities: input }]);
    expect(input.map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("buildDayRouteLegs", () => {
  const stop = (id: string, dayId: string, completed = false) => ({
    id,
    dayId,
    completed,
    position: [Number(id.length), 0] as [number, number],
  });

  it("joins consecutive stops of the same day only", () => {
    const legs = buildDayRouteLegs([stop("a", "d1"), stop("b", "d1"), stop("c", "d2"), stop("d", "d2")]);
    expect(legs.map((l) => [l.fromId, l.toId, l.dayId])).toEqual([
      ["a", "b", "d1"],
      ["c", "d", "d2"],
    ]);
  });

  it("draws nothing for a day with a single stop", () => {
    expect(buildDayRouteLegs([stop("a", "d1"), stop("c", "d2")])).toEqual([]);
  });

  it("keeps the done flag of each leg", () => {
    const legs = buildDayRouteLegs([stop("a", "d1", true), stop("b", "d1", true), stop("c", "d1")]);
    expect(legs.map((l) => l.done)).toEqual([true, false]);
  });
});
