import { tripTimeZone } from "@/lib/day-genius/context";
import { isTripUndated } from "@/lib/trip-undated";
import type { TripPlan } from "@/lib/types";

/**
 * The trip as a calendar file (RFC 5545) that Google Calendar, Apple Calendar and Outlook import:
 * one event per planned activity (skipped ones are left out), at its local time in the trip's
 * time zone, written in UTC so every calendar places it at the same moment.
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_DURATION_MIN = 60;
const MAX_LINE_OCTETS = 75;

/** Offset of `zone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant of a wall-clock `date` + `time` in `zone`, daylight saving included. */
export function localTimeToUtc(date: string, time: string, zone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  // Twice: the offset at the guessed instant may differ from the one at the real instant (DST).
  let instant = wallClock - zoneOffsetMs(wallClock, zone);
  instant = wallClock - zoneOffsetMs(instant, zone);
  return new Date(instant);
}

const pad = (value: number) => String(value).padStart(2, "0");
const utcStamp = (date: Date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const dateStamp = (date: string) => date.replaceAll("-", "");
const nextDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

/** TEXT values escape backslashes, semicolons, commas and newlines. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets continue on the next line after a space, never splitting a character. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75 octets.
    const limit = chunks.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (size + charSize > limit) {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += charSize;
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

/** The calendar text, or null for a trip planned by number of days (its dates are placeholders). */
export function buildTripIcs(trip: TripPlan, options: { now: Date; deviceZone: string }): string | null {
  if (isTripUndated(trip)) return null;
  const zone = tripTimeZone(trip, options.deviceZone);
  const stamp = utcStamp(options.now);

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tachao//Trip//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(trip.name)}`];
  for (const day of trip.days) {
    for (const activity of day.activities) {
      if (activity.state === "skipped") continue;
      lines.push("BEGIN:VEVENT", `UID:${activity.id}@tachao.app`, `DTSTAMP:${stamp}`);
      if (TIME_RE.test(activity.time)) {
        const start = localTimeToUtc(day.date, activity.time, zone);
        const minutes = activity.durationMin > 0 ? activity.durationMin : DEFAULT_DURATION_MIN;
        lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(new Date(start.getTime() + minutes * 60_000))}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${dateStamp(day.date)}`, `DTEND;VALUE=DATE:${dateStamp(nextDate(day.date))}`);
      }
      lines.push(`SUMMARY:${escapeText(activity.title)}`);
      if (activity.location?.trim()) lines.push(`LOCATION:${escapeText(activity.location.trim())}`);
      if (activity.notes?.trim()) lines.push(`DESCRIPTION:${escapeText(activity.notes.trim())}`);
      lines.push("END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A safe file name from the trip name: "Madrid, otoño 2026" -> "madrid-otono-2026.ics". */
export function icsFileName(tripName: string): string {
  const slug = tripName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "tachao"}.ics`;
}
