import type { BookingMoment } from "@/lib/types";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/** Returns true when `value` is a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Returns true when `value` is a 24h HH:mm time. */
export function isValidTime(value: string): boolean {
  const match = TIME_RE.exec(value);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}

/** Returns true when `zone` is an IANA time zone supported by the runtime. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock milliseconds of a local date/time, as if it were UTC. */
function wallClockMs(date: string, time: string): number | null {
  if (!isValidIsoDate(date) || !isValidTime(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes);
}

/** Offset (ms) of `zone` from UTC at the UTC instant `utcMs`. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** UTC instant of a local wall-clock time in `zone` (non-existent DST times resolve forward). */
function toUtcMs(wallMs: number, zone: string): number {
  let utc = wallMs - zoneOffsetMs(zone, wallMs);
  const corrected = wallMs - zoneOffsetMs(zone, utc);
  if (corrected !== utc) utc = corrected;
  return utc;
}

/**
 * Minutes between two booking moments. Needs date and time on both. Uses both time zones when
 * present, otherwise assumes both moments share a zone. Null when incomplete, invalid or negative.
 */
export function minutesBetween(start: BookingMoment, end: BookingMoment): number | null {
  if (!start.date || !start.time || !end.date || !end.time) return null;
  const startWall = wallClockMs(start.date, start.time);
  const endWall = wallClockMs(end.date, end.time);
  if (startWall === null || endWall === null) return null;

  let diffMs: number;
  if (start.timeZone && end.timeZone) {
    if (!isValidTimeZone(start.timeZone) || !isValidTimeZone(end.timeZone)) return null;
    diffMs = toUtcMs(endWall, end.timeZone) - toUtcMs(startWall, start.timeZone);
  } else {
    const zone = start.timeZone ?? end.timeZone;
    if (zone && !isValidTimeZone(zone)) return null;
    diffMs = zone ? toUtcMs(endWall, zone) - toUtcMs(startWall, zone) : endWall - startWall;
  }

  const minutes = Math.round(diffMs / 60000);
  return minutes < 0 ? null : minutes;
}
