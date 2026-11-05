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
