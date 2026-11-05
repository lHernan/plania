import type { PublicMemory } from "@/lib/types";

export type PublicStoryActivity = { id: string; day_id: string; title: string; time?: string; state?: string };
export type PublicStoryDay<Day> = {
  day: Day;
  /** 1-based position of the day in the trip. */
  dayNumber: number;
  /** Completed activities and those with public memories, by time, each with its memories. */
  activities: Array<{ activity: PublicStoryActivity; memories: PublicMemory[] }>;
};

/** Public memories of the whole trip, not about one activity (or about an activity no longer shown). */
export function publicTripMemories(memories: PublicMemory[], activities: PublicStoryActivity[]): PublicMemory[] {
  const known = new Set(activities.map((activity) => activity.id));
  return memories.filter((memory) => !memory.activityId || !known.has(memory.activityId));
}

/** The public story by day, in trip order: only days with completed activities or public memories. */
export function publicStoryDays<Day extends { id: string }>(
  days: Day[],
  activities: PublicStoryActivity[],
  memories: PublicMemory[],
): PublicStoryDay<Day>[] {
  return days
    .map((day, index) => ({
      day,
      dayNumber: index + 1,
      activities: activities
        .filter((activity) => activity.day_id === day.id)
        .map((activity) => ({ activity, memories: memories.filter((memory) => memory.activityId === activity.id) }))
        .filter(({ activity, memories: own }) => activity.state === "completed" || own.length > 0)
        .sort((left, right) => (left.activity.time ?? "").localeCompare(right.activity.time ?? "")),
    }))
    .filter((entry) => entry.activities.length > 0);
}
