import { describe, expect, it } from "vitest";
import { minutesBetween } from "@/lib/bookings/timezone";

describe("minutesBetween", () => {
  it("accounts for the Madrid to Canary one-hour difference", () => {
    expect(minutesBetween(
      { date: "2026-06-10", time: "10:00", timeZone: "Europe/Madrid" },
      { date: "2026-06-10", time: "11:55", timeZone: "Atlantic/Canary" },
    )).toBe(175);
    expect(minutesBetween(
      { date: "2026-06-17", time: "18:30", timeZone: "Atlantic/Canary" },
      { date: "2026-06-17", time: "22:15", timeZone: "Europe/Madrid" },
    )).toBe(165);
  });

  it("handles a DST change in the same zone", () => {
    expect(minutesBetween(
      { date: "2026-03-29", time: "01:30", timeZone: "Europe/Madrid" },
      { date: "2026-03-29", time: "03:30", timeZone: "Europe/Madrid" },
    )).toBe(60);
  });

  it("assumes the same zone when zones are missing and spans days", () => {
    expect(minutesBetween({ date: "2026-06-10", time: "23:00" }, { date: "2026-06-11", time: "01:00" })).toBe(120);
    expect(minutesBetween({ date: "2026-06-10", time: "10:00", timeZone: "Europe/Madrid" }, { date: "2026-06-10", time: "11:00" })).toBe(60);
  });

  it("returns null when impossible, incomplete or negative", () => {
    expect(minutesBetween({ date: "2026-06-10" }, { date: "2026-06-10", time: "11:00" })).toBeNull();
    expect(minutesBetween({ date: "2026-06-10", time: "12:00" }, { date: "2026-06-10", time: "11:00" })).toBeNull();
    expect(minutesBetween({ date: "2026-13-10", time: "10:00" }, { date: "2026-06-10", time: "11:00" })).toBeNull();
    expect(minutesBetween(
      { date: "2026-06-10", time: "10:00", timeZone: "Bad/Zone" },
      { date: "2026-06-10", time: "11:00", timeZone: "Europe/Madrid" },
    )).toBeNull();
  });
});
