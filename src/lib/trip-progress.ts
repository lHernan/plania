import type { Activity, TripDay, TripPlan } from "@/lib/types";

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
