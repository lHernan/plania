import { describe, expect, it } from "vitest";
import { daysUntilStart, nowNext, tripMode } from "@/lib/trip-mode";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";

const dated = (startDate?: string, endDate?: string) => ({ ...makeTrip([]), startDate, endDate });
const withDays = (...dates: string[]) =>
  makeTrip(dates.map((date, i) => ({ ...makeDay(`d${i}`, []), date })));

describe("tripMode", () => {
  it("is planning before the start date", () => {
    expect(tripMode(dated("2026-11-10", "2026-11-15"), "2026-11-05")).toBe("planning");
  });

  it("is today on the first day, inside the range and on the last day", () => {
    const trip = dated("2026-11-05", "2026-11-08");
    expect(tripMode(trip, "2026-11-05")).toBe("today");
    expect(tripMode(trip, "2026-11-06")).toBe("today");
    expect(tripMode(trip, "2026-11-08")).toBe("today");
  });

  it("is memory after the end date", () => {
    expect(tripMode(dated("2026-10-01", "2026-10-05"), "2026-10-06")).toBe("memory");
  });

  it("falls back to the first and last day dates when the trip has no dates", () => {
    const trip = withDays("2026-10-27", "2026-10-26");
    expect(tripMode(trip, "2026-10-25")).toBe("planning");
    expect(tripMode(trip, "2026-10-27")).toBe("today");
    expect(tripMode(trip, "2026-10-28")).toBe("memory");
  });

  it("is planning for a trip without any dates", () => {
    expect(tripMode(makeTrip([]), "2026-11-05")).toBe("planning");
    expect(tripMode(withDays(""), "2026-11-05")).toBe("planning");
  });
});

describe("daysUntilStart", () => {
  it("counts calendar days to the start, and is null without dates", () => {
    expect(daysUntilStart(dated("2026-11-10", "2026-11-12"), "2026-11-05")).toBe(5);
    expect(daysUntilStart(dated("2026-11-06", "2026-11-12"), "2026-11-05")).toBe(1);
    expect(daysUntilStart(withDays("2026-12-01"), "2026-11-30")).toBe(1);
    expect(daysUntilStart(makeTrip([]), "2026-11-05")).toBeNull();
  });
});

describe("nowNext", () => {
  const day = (...activities: ReturnType<typeof makeActivity>[]) => makeDay("d", activities);
  const museum = makeActivity("museum", { time: "10:00", durationMin: 90 });
  const lunch = makeActivity("lunch", { time: "13:00", durationMin: 60 });

  it("gives the activity in progress and the next one", () => {
    expect(nowNext(day(lunch, museum), "10:30")).toEqual({ now: museum, next: lunch });
  });

  it("counts the exact start as in progress", () => {
    expect(nowNext(day(museum, lunch), "10:00")).toEqual({ now: museum, next: lunch });
  });

  it("does not count the exact end as in progress", () => {
    expect(nowNext(day(museum, lunch), "11:30")).toEqual({ now: undefined, next: lunch });
  });

  it("has no now before the first activity, only next", () => {
    expect(nowNext(day(museum, lunch), "08:00")).toEqual({ now: undefined, next: museum });
  });

  it("has no next during the last activity of the day", () => {
    expect(nowNext(day(museum, lunch), "13:15")).toEqual({ now: lunch, next: undefined });
  });

  it("is empty after the last activity and on an empty day", () => {
    expect(nowNext(day(museum, lunch), "20:00")).toEqual({ now: undefined, next: undefined });
    expect(nowNext(day(), "10:00")).toEqual({ now: undefined, next: undefined });
  });

  it("ignores completed and skipped activities", () => {
    const done = { ...museum, state: "completed" as const };
    const skipped = { ...lunch, state: "skipped" as const };
    const dinner = makeActivity("dinner", { time: "20:00" });
    expect(nowNext(day(done, skipped, dinner), "10:30")).toEqual({ now: undefined, next: dinner });
  });

  it("keeps delayed activities as pending", () => {
    const delayed = { ...lunch, state: "delayed" as const };
    expect(nowNext(day(delayed), "12:00")).toEqual({ now: undefined, next: delayed });
  });

  it("ignores activities without a time", () => {
    const untimed = makeActivity("untimed", { time: "" });
    expect(nowNext(day(untimed, lunch), "09:00")).toEqual({ now: undefined, next: lunch });
  });

  it("counts an activity without duration as in progress only at its start minute", () => {
    const call = makeActivity("call", { time: "09:00", durationMin: 0 });
    expect(nowNext(day(call, lunch), "09:00").now).toBe(call);
    expect(nowNext(day(call, lunch), "09:01").now).toBeUndefined();
  });

  it("picks the most recently started of overlapping activities", () => {
    const tour = makeActivity("tour", { time: "10:15", durationMin: 30 });
    expect(nowNext(day(museum, tour, lunch), "10:20")).toEqual({ now: tour, next: lunch });
  });
});
