import { describe, expect, it } from "vitest";
import { buildTripContext } from "@/lib/ai/trip-context";
import { buildDraftTrip } from "@/lib/planner/form";
import { parseTravelContext } from "@/lib/travel-context";
import { daysUntilStart, tripMode } from "@/lib/trip-mode";
import { consecutiveDates, isTripUndated, withoutUndatedFlag, dayUrlParam, findDayByUrlParam } from "@/lib/trip-undated";
import { selectTripDocuments } from "@/lib/wallet";
import type { ActivityFile, TravelContext } from "@/lib/types";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";

const UNDATED: TravelContext = { version: 1, undated: true };
const placeholderDays = (...dates: string[]) => dates.map((date, i) => ({ ...makeDay(`d${i + 1}`, []), date }));

describe("the undated flag of the travel context", () => {
  it("parses undated: true and rejects a non-boolean value", () => {
    expect(parseTravelContext({ version: 1, undated: true })).toEqual({ version: 1, undated: true });
    expect(parseTravelContext({ version: 1, undated: "yes" })).toBeNull();
  });

  it("parses contexts without the flag as before", () => {
    expect(parseTravelContext({ version: 1, travelerCount: 2 })).toEqual({ version: 1, travelerCount: 2 });
  });

  it("drops the flag, keeping the rest of the context", () => {
    expect(withoutUndatedFlag({ version: 1, undated: true, currency: "EUR" })).toEqual({ version: 1, currency: "EUR" });
    expect(withoutUndatedFlag({ version: 1, undated: true })).toBeNull();
  });

  it("marks a trip as undated only with the flag", () => {
    expect(isTripUndated({ travelContext: UNDATED })).toBe(true);
    expect(isTripUndated({ travelContext: { version: 1, currency: "EUR" } })).toBe(false);
    expect(isTripUndated(null)).toBe(false);
  });
});

describe("consecutiveDates", () => {
  it("gives one date per day from the start, across months", () => {
    expect(consecutiveDates("2027-01-30", 4)).toEqual(["2027-01-30", "2027-01-31", "2027-02-01", "2027-02-02"]);
    expect(consecutiveDates("2027-01-30", 0)).toEqual([]);
  });
});

describe("a planner draft by number of days", () => {
  it("is undated: flagged, N days and no trip dates", () => {
    const plan = buildDraftTrip({
      id: "draft-1",
      name: "Lisboa",
      destinations: ["Lisboa"],
      dates: ["2026-11-05", "2026-11-06", "2026-11-07"],
      undated: true,
      preferences: { budgetLevel: "low" },
    });
    expect(plan.days).toHaveLength(3);
    expect(plan.travelContext).toEqual({ version: 1, undated: true, preferences: { budgetLevel: "low" } });
    expect(plan.startDate).toBeUndefined();
    expect(plan.endDate).toBeUndefined();
  });

  it("with dates keeps its dates and no flag", () => {
    const plan = buildDraftTrip({ id: "draft-2", name: "Kioto", destinations: ["Kioto"], dates: ["2027-04-01", "2027-04-02"] });
    expect(plan.startDate).toBe("2027-04-01");
    expect(plan.endDate).toBe("2027-04-02");
    expect(plan.travelContext).toBeUndefined();
  });
});

describe("trip mode of an undated trip", () => {
  it("is planning with no countdown, even when the placeholder dates include today", () => {
    const trip = { ...makeTrip(placeholderDays("2026-11-04", "2026-11-05", "2026-11-06")), travelContext: UNDATED };
    expect(tripMode(trip, "2026-11-05")).toBe("planning");
    expect(tripMode(trip, "2026-12-01")).toBe("planning");
    expect(daysUntilStart(trip, "2026-11-01")).toBeNull();
  });

  it("is unchanged for a dated trip with the same days", () => {
    const trip = makeTrip(placeholderDays("2026-11-04", "2026-11-05", "2026-11-06"));
    expect(tripMode(trip, "2026-11-05")).toBe("today");
    expect(daysUntilStart(trip, "2026-11-01")).toBe(3);
  });
});

describe("AI trip context of an undated trip", () => {
  const input = (travelContext?: TravelContext) => ({
    trip: { id: "t1", name: "Lisboa", startDate: null, endDate: null, ownerId: "u1", travelContext },
    days: [
      { id: "d1", date: "2026-11-05", city: "Lisboa", label: "Day 1", activities: [] },
      { id: "d2", date: "2026-11-06", city: "Lisboa", label: "Day 2", activities: [] },
    ],
    reservations: [],
    currentDate: "2026-11-05",
    currentTime: "10:00",
  });

  it("does not include the placeholder dates and says the trip is undated", () => {
    const context = buildTripContext(input(UNDATED));
    expect(JSON.stringify(context)).not.toContain("2026-11-06");
    expect(context.trip).toMatchObject({ undated: true, startDate: null, endDate: null });
    expect(context.days.map((day) => [day.date, day.dayNumber])).toEqual([[null, 1], [null, 2]]);
  });

  it("keeps the day dates of a dated trip", () => {
    const context = buildTripContext(input());
    expect(context.days.map((day) => day.date)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(context.trip).not.toHaveProperty("undated");
  });
});

describe("wallet documents of an undated trip", () => {
  const file: ActivityFile = {
    id: "f1", activityId: "a1", tripId: "t", userId: "u", fileUrl: "", filePath: "", fileType: "pdf", fileName: "x.pdf", createdAt: "",
  };
  const days = [{ ...makeDay("d1", [makeActivity("a1", { files: [file] })]), date: "2026-11-05" }];

  it("have no day date", () => {
    expect(selectTripDocuments({ ...makeTrip(days), travelContext: UNDATED })[0].dayDate).toBe("");
  });

  it("keep the day date on a dated trip", () => {
    expect(selectTripDocuments(makeTrip(days))[0].dayDate).toBe("2026-11-05");
  });
});

describe("day URL param", () => {
  const days = [
    { id: "d1", date: "2026-11-15" },
    { id: "d2", date: "2026-11-16" },
  ];
  const dated = { travelContext: null, days };
  const undated = { travelContext: { version: 1 as const, undated: true }, days };

  it("is the date on a dated trip and the day number on an undated one", () => {
    expect(dayUrlParam(dated, days[1])).toBe("2026-11-16");
    expect(dayUrlParam(undated, days[1])).toBe("2");
    expect(dayUrlParam(undated, undefined)).toBeNull();
  });

  it("finds the day by date on a dated trip and by number on an undated one, still accepting old date links", () => {
    expect(findDayByUrlParam(dated, "2026-11-16")?.id).toBe("d2");
    expect(findDayByUrlParam(dated, "2")).toBeUndefined();
    expect(findDayByUrlParam(undated, "2")?.id).toBe("d2");
    expect(findDayByUrlParam(undated, "2026-11-15")?.id).toBe("d1");
    expect(findDayByUrlParam(undated, "3")).toBeUndefined();
    expect(findDayByUrlParam(undated, "0")).toBeUndefined();
    expect(findDayByUrlParam(undated, null)).toBeUndefined();
  });
});
