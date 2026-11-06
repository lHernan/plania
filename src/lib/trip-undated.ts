import { addDays, format, parseISO } from "date-fns";
import type { TravelContext } from "@/lib/types";

/**
 * A trip planned by number of days only. Its days keep placeholder dates (consecutive, in
 * day order) so the data model stays the same, but they are never shown, never "today" and
 * never used to group or select the trip; the trip itself has no start or end date.
 */
export function isTripUndated(trip: { travelContext?: TravelContext | null } | null | undefined): boolean {
  return trip?.travelContext?.undated === true;
}

/** `count` consecutive "yyyy-MM-dd" dates from `start`. */
export function consecutiveDates(start: string, count: number): string[] {
  const first = parseISO(start);
  return Array.from({ length: Math.max(0, count) }, (_, i) => format(addDays(first, i), "yyyy-MM-dd"));
}

/** The travel context once the trip has dates: without the flag, or null when nothing else is left. */
export function withoutUndatedFlag(context: TravelContext | null | undefined): TravelContext | null {
  if (!context) return null;
  const rest = { ...context };
  delete rest.undated;
  return Object.keys(rest).length > 1 ? rest : null;
}

type DayRef = { id: string; date: string };
type TripDays<Day extends DayRef> = { travelContext?: TravelContext | null; days: Day[] };

/**
 * The `?day=` value of a day: its date on a dated trip, its number ("1".."N") on an undated one,
 * whose placeholder dates are never shown.
 */
export function dayUrlParam<Day extends DayRef>(trip: TripDays<Day>, day: DayRef | null | undefined): string | null {
  if (!day) return null;
  if (!isTripUndated(trip)) return day.date;
  const index = trip.days.findIndex((entry) => entry.id === day.id);
  return index >= 0 ? String(index + 1) : null;
}

/** The day a `?day=` value names. An undated trip also accepts older links with a placeholder date. */
export function findDayByUrlParam<Day extends DayRef>(trip: TripDays<Day>, param: string | null | undefined): Day | undefined {
  if (!param) return undefined;
  if (isTripUndated(trip) && /^\d+$/.test(param)) return trip.days[Number(param) - 1];
  return trip.days.find((day) => day.date === param);
}
