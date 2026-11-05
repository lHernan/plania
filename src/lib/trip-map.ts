import type { Activity } from "@/lib/types";
import { buildRouteLegs, type RouteLeg, type RouteStop } from "@/lib/trip-progress";

/** The minimal shape of a trip day the map needs; `TripDay` satisfies it. */
export type TripMapDay = { id: string; city: string; activities: Activity[] };

/** One activity placed in the trip: its day, that day's city and its stop number within the day. */
export type TripMapEntry = {
  activity: Activity;
  dayId: string;
  dayIndex: number;
  city: string;
  order: number;
};

/**
 * Day colors for the whole-trip map. Dark enough to carry white text, distinct from
 * each other; the first one is the brand green so a one-day view still feels familiar.
 */
export const DAY_COLORS = [
  "#246B57",
  "#C2410C",
  "#1D4ED8",
  "#9D174D",
  "#7C3AED",
  "#A16207",
  "#0F766E",
  "#B91C1C",
] as const;

/** Long trips reuse the palette; the day number on each marker keeps them apart. */
export function dayColor(dayIndex: number): string {
  const size = DAY_COLORS.length;
  return DAY_COLORS[((dayIndex % size) + size) % size];
}

/** Itinerary order: by time, ties by sort order. Returns a new array. */
export function sortByItinerary(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => a.time.localeCompare(b.time) || a.sort_order - b.sort_order);
}

/**
 * Flattens days into map entries, day by day in itinerary order. The stop number counts
 * every activity of the day (with or without location) so it matches the itinerary.
 */
export function aggregateTripActivities(days: TripMapDay[]): TripMapEntry[] {
  return days.flatMap((day, dayIndex) =>
    sortByItinerary(day.activities).map((activity, index) => ({
      activity,
      dayId: day.id,
      dayIndex,
      city: day.city,
      order: index + 1,
    }))
  );
}

export type DayRouteStop = RouteStop & { dayId: string };
export type DayRouteLeg = RouteLeg & { dayId: string };

/** Visit-order legs drawn per day: consecutive stops are joined only when they share a day. */
export function buildDayRouteLegs(stops: DayRouteStop[]): DayRouteLeg[] {
  const byDay = new Map<string, DayRouteStop[]>();
  for (const stop of stops) {
    const group = byDay.get(stop.dayId);
    if (group) group.push(stop);
    else byDay.set(stop.dayId, [stop]);
  }
  return [...byDay].flatMap(([dayId, dayStops]) => buildRouteLegs(dayStops).map((leg) => ({ ...leg, dayId })));
}
