import type { Activity, ActivityCategory, TripDay, TripPlan } from "@/lib/types";

export type CelebrationTier = 1 | 2 | 3;

export type CompletionCelebration = {
  tier: CelebrationTier;
  nextDayId?: string;
};

export type MapStatusFilter = "all" | "pending" | "completed";

export const isActivityCompleted = (activity: Activity) => activity.state === "completed";

// A day without activities is never considered completed.
export function isDayComplete(day: TripDay): boolean {
  return day.activities.length > 0 && day.activities.every(isActivityCompleted);
}

export function hasPendingActivities(day: TripDay): boolean {
  return day.activities.some((a) => !isActivityCompleted(a));
}

// Days without activities don't count; a trip needs at least one activity.
export function isTripComplete(trip: TripPlan): boolean {
  const activities = trip.days.flatMap((d) => d.activities);
  return activities.length > 0 && activities.every(isActivityCompleted);
}

// Next real day with pending work: searches forward first, then wraps to earlier days.
export function findNextPendingDayId(days: TripDay[], fromDayId: string): string | undefined {
  const index = days.findIndex((d) => d.id === fromDayId);
  const ordered = [...days.slice(index + 1), ...days.slice(0, Math.max(index, 0))];
  return ordered.find((d) => d.id !== fromDayId && hasPendingActivities(d))?.id;
}

// Decides the celebration for completing one activity, using the state BEFORE the update.
// The last pending activity of a day yields only the day tier, never tier 1 + tier 2.
export function computeCompletionCelebration(
  trip: TripPlan,
  dayId: string,
  activityId: string
): CompletionCelebration | null {
  const day = trip.days.find((d) => d.id === dayId);
  const activity = day?.activities.find((a) => a.id === activityId);
  if (!day || !activity || isActivityCompleted(activity)) return null;

  const isPendingOther = (a: Activity) => a.id !== activityId && !isActivityCompleted(a);
  const remainingInDay = day.activities.filter(isPendingOther).length;
  if (remainingInDay > 0) return { tier: 1 };

  const remainingInTrip = trip.days.reduce((sum, d) => sum + d.activities.filter(isPendingOther).length, 0);
  if (remainingInTrip === 0) return { tier: 3 };

  const afterUpdate = trip.days.map((d) =>
    d.id === dayId
      ? { ...d, activities: d.activities.map((a) => (a.id === activityId ? { ...a, state: "completed" as const } : a)) }
      : d
  );
  return { tier: 2, nextDayId: findNextPendingDayId(afterUpdate, dayId) };
}

// Visibility only — returns a new array and never touches activity state.
export function filterActivitiesByMapStatus(activities: Activity[], filter: MapStatusFilter): Activity[] {
  if (filter === "pending") return activities.filter((a) => !isActivityCompleted(a));
  if (filter === "completed") return activities.filter(isActivityCompleted);
  return [...activities];
}

export type MapFilters = {
  status: MapStatusFilter;
  categories: ActivityCategory[];
  query: string;
};

export const DEFAULT_MAP_FILTERS: MapFilters = { status: "all", categories: [], query: "" };

// Same order as the ActivityCategory union, so chips never reshuffle.
const CATEGORY_ORDER: ActivityCategory[] = [
  "sightseeing", "reservation", "transport", "hotel", "food", "shopping", "photos", "nightlife", "other",
];

// Case- and accent-insensitive, so "cafe" finds "Café".
function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function matchesMapQuery(activity: Activity, query: string): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  return [activity.title, activity.location ?? ""].some((field) => normalizeSearch(field).includes(needle));
}

/** Status, categories (any of) and search combined. Visibility only — never touches activity state. */
export function filterMapActivities(activities: Activity[], filters: MapFilters): Activity[] {
  return filterActivitiesByMapStatus(activities, filters.status).filter(
    (a) =>
      (filters.categories.length === 0 || filters.categories.includes(a.category)) &&
      matchesMapQuery(a, filters.query)
  );
}

export function hasNarrowingMapFilters(filters: MapFilters): boolean {
  return filters.status !== "all" || filters.categories.length > 0 || normalizeSearch(filters.query) !== "";
}

export function availableCategories(activities: Activity[]): ActivityCategory[] {
  const present = new Set(activities.map((a) => a.category));
  return CATEGORY_ORDER.filter((c) => present.has(c));
}

export type RouteStop = { id: string; completed: boolean; position: [number, number] };
export type RouteLeg = { fromId: string; toId: string; done: boolean; positions: [[number, number], [number, number]] };

/**
 * Straight segments between consecutive stops in itinerary order — a visual sequence,
 * not a street route. A leg counts as done only when both of its ends are completed.
 */
export function buildRouteLegs(stops: RouteStop[]): RouteLeg[] {
  return stops.slice(1).map((to, i) => {
    const from = stops[i];
    return { fromId: from.id, toId: to.id, done: from.completed && to.completed, positions: [from.position, to.position] };
  });
}
