import { describe, expect, it } from "vitest";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";
import { buildTripIcs, icsFileName, localTimeToUtc } from "@/lib/calendar/ics";
import type { TripPlan } from "@/lib/types";

// S1: the trip's activities as a calendar file (.ics) for Google, Apple or Outlook.
const NOW = new Date("2026-11-06T10:00:00Z");

function trip(overrides: Partial<TripPlan> = {}): TripPlan {
  const d1 = makeDay("d1", [
    makeActivity("a1", { title: "Museo del Prado", time: "10:00", durationMin: 90, location: "Calle Ruiz de Alarcón, 23", notes: "Entradas; llevar DNI, y agua\nsegunda línea" }),
    makeActivity("a2", { title: "Comida", time: "14:30", durationMin: 0 }),
    makeActivity("a3", { title: "Paseo que se saltó", time: "18:00", state: "skipped" }),
    makeActivity("a4", { title: "Algo sin hora", time: "" }),
  ]);
  const d2 = { ...makeDay("d2", [makeActivity("b1", { title: "Retiro", time: "09:00", durationMin: 60 })]), date: "2026-10-27" };
  return { ...makeTrip([d1, d2]), id: "t1", name: "Madrid, otoño", travelContext: { version: 1, arrival: { timeZone: "Europe/Madrid" } }, ...overrides };
}

const events = (ics: string) => ics.split("BEGIN:VEVENT").slice(1).map((block) => block.split("END:VEVENT")[0]);
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("localTimeToUtc", () => {
  it("turns a local time of a time zone into UTC, across daylight saving", () => {
    expect(localTimeToUtc("2026-10-26", "10:00", "Europe/Madrid").toISOString()).toBe("2026-10-26T09:00:00.000Z");
    expect(localTimeToUtc("2026-07-01", "10:00", "Europe/Madrid").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(localTimeToUtc("2026-07-01", "10:00", "America/Argentina/Buenos_Aires").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
});

describe("buildTripIcs", () => {
  it("is a valid calendar with one event per planned activity, at its local time in the trip's zone", () => {
    const ics = buildTripIcs(trip(), { now: NOW, deviceZone: "UTC" })!;
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Tachao//Trip//ES");
    expect(unfold(ics)).toContain("X-WR-CALNAME:Madrid\\, otoño");
    expect(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);

    const list = events(unfold(ics));
    expect(list).toHaveLength(4);
    const prado = list[0];
    expect(prado).toContain("UID:a1@tachao.app");
    expect(prado).toContain("DTSTAMP:20261106T100000Z");
    expect(prado).toContain("DTSTART:20261026T090000Z");
    expect(prado).toContain("DTEND:20261026T103000Z");
    expect(prado).toContain("SUMMARY:Museo del Prado");
    expect(prado).toContain("LOCATION:Calle Ruiz de Alarcón\\, 23");
    expect(prado).toContain("DESCRIPTION:Entradas\\; llevar DNI\\, y agua\\nsegunda línea");
  });

  it("gives an activity without a duration one hour, and an activity without a time a whole day", () => {
    const list = events(unfold(buildTripIcs(trip(), { now: NOW, deviceZone: "UTC" })!));
    expect(list[1]).toContain("DTSTART:20261026T133000Z");
    expect(list[1]).toContain("DTEND:20261026T143000Z");
    expect(list[2]).toContain("SUMMARY:Algo sin hora");
    expect(list[2]).toContain("DTSTART;VALUE=DATE:20261026");
    expect(list[2]).toContain("DTEND;VALUE=DATE:20261027");
  });

  it("leaves out skipped activities", () => {
    expect(buildTripIcs(trip(), { now: NOW, deviceZone: "UTC" })).not.toContain("Paseo que se saltó");
  });

  it("uses the device's zone when the trip has none", () => {
    const ics = buildTripIcs(trip({ travelContext: undefined }), { now: NOW, deviceZone: "America/Argentina/Buenos_Aires" })!;
    expect(events(ics)[0]).toContain("DTSTART:20261026T130000Z");
  });

  it("is not available for a trip planned by number of days, whose dates are placeholders", () => {
    expect(buildTripIcs(trip({ travelContext: { version: 1, undated: true } }), { now: NOW, deviceZone: "UTC" })).toBeNull();
  });

  it("names the file after the trip", () => {
    expect(icsFileName("Madrid, otoño 2026!")).toBe("madrid-otono-2026.ics");
    expect(icsFileName("   ")).toBe("tachao.ics");
  });
});
