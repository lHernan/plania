import type { Activity, TripDay } from "@/lib/types";

type DbError = { code?: string; message?: string } | null;
type Query = PromiseLike<{ data: unknown; error: DbError }> & { eq: (column: string, value: string) => Query };
export type ParticipantsReadClient = { from: (table: string) => { select: (columns: string) => Query } };

/**
 * Who each activity of a trip is assigned to (activity id -> user ids). Null when the table is
 * missing (migration not applied) or the read failed, so callers keep what they had.
 */
export async function loadActivityParticipants(client: ParticipantsReadClient, tripId: string): Promise<Map<string, string[]> | null> {
  try {
    const { data, error } = await client.from("activity_participants").select("activity_id, user_id").eq("trip_id", tripId);
    if (error) {
      console.warn("Activity participants load failed:", error.message);
      return null;
    }
    const byActivity = new Map<string, string[]>();
    for (const row of (Array.isArray(data) ? data : []) as { activity_id: string; user_id: string }[]) {
      const list = byActivity.get(row.activity_id);
      if (list) list.push(row.user_id);
      else byActivity.set(row.activity_id, [row.user_id]);
    }
    return byActivity;
  } catch (error) {
    console.warn("Activity participants load failed:", error);
    return null;
  }
}

/**
 * Days with each activity's participants. Without a fresh read (`byActivity` null) the
 * assignments of the same activities in `previous` (the offline cache) are kept.
 */
export function withParticipants(days: TripDay[], byActivity: Map<string, string[]> | null, previous?: TripDay[]): TripDay[] {
  const fallback = new Map<string, string[]>();
  if (!byActivity) {
    for (const day of previous ?? []) {
      for (const activity of day.activities) if (activity.participantIds?.length) fallback.set(activity.id, activity.participantIds);
    }
  }
  const source = byActivity ?? fallback;
  return days.map((day) => ({
    ...day,
    activities: day.activities.map((activity) => ({ ...activity, participantIds: source.get(activity.id) ?? [] })),
  }));
}

/** An activity with nobody assigned is shared with every member of the trip. */
export function isSharedActivity(activity: Pick<Activity, "participantIds">): boolean {
  return !activity.participantIds || activity.participantIds.length === 0;
}

/**
 * The itinerary of one person: shared activities plus the ones assigned to them.
 * A null person means everyone: every activity of the trip.
 */
export function activitiesForPerson<T extends Pick<Activity, "participantIds">>(activities: T[], personId: string | null): T[] {
  if (!personId) return activities;
  return activities.filter((activity) => isSharedActivity(activity) || activity.participantIds!.includes(personId));
}
