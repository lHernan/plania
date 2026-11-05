import type { MemoryError } from "@/lib/memories-sync";
import type { Activity, Memory, TripDay, TripMember, TripPlan } from "@/lib/types";

/** Message key of each reason a memory action did not happen. */
export const MEMORY_ERROR_KEYS: Record<MemoryError, string> = {
  draft: "memory_error_draft",
  offline: "memory_error_offline",
  forbidden: "memory_error_forbidden",
  invalid: "memory_error_invalid",
  unavailable: "memory_error_unavailable",
  failed: "memory_error_failed",
};

export function memoriesForActivity(memories: Memory[], activityId: string): Memory[] {
  return memories.filter((memory) => memory.activityId === activityId);
}

/** Memories of the whole trip, not about one activity. */
export function tripLevelMemories(memories: Memory[]): Memory[] {
  return memories.filter((memory) => !memory.activityId);
}

export type MemoryStoryDay = {
  day: TripDay;
  /** 1-based position of the day in the trip. */
  dayNumber: number;
  /** Completed activities and those with memories, by time. */
  activities: Activity[];
};

/** The trip's story: each day that has completed activities or memories, in trip order. */
export function memoryStoryDays(trip: Pick<TripPlan, "days">, memories: Memory[]): MemoryStoryDay[] {
  const remembered = new Set(memories.map((memory) => memory.activityId).filter(Boolean));
  return trip.days
    .map((day, index) => ({
      day,
      dayNumber: index + 1,
      activities: day.activities
        .filter((activity) => activity.state === "completed" || remembered.has(activity.id))
        .sort((left, right) => (left.time ?? "").localeCompare(right.time ?? "")),
    }))
    .filter((entry) => entry.activities.length > 0);
}

export type MemoryPerson = { kind: "you" } | { kind: "email"; email: string } | { kind: "unknown" };

/** How to name a person of the trip: the viewer is "you", others go by email. */
export function memoryPerson(userId: string, currentUserId: string | null, members: TripMember[]): MemoryPerson {
  if (currentUserId && userId === currentUserId) return { kind: "you" };
  const email = members.find((member) => member.userId === userId)?.email;
  return email ? { kind: "email", email } : { kind: "unknown" };
}

/** Everyone who sees a memory shared with some people: its author first, then its audience. */
export function memoryViewers(memory: Pick<Memory, "authorId" | "audienceUserIds">): string[] {
  return [...new Set([memory.authorId, ...memory.audienceUserIds])];
}
