import { toMinutes } from "@/lib/bookings/plan";
import type { GeniusChange } from "@/lib/day-genius/validate";
import type { Activity, TripDay } from "@/lib/types";

/**
 * Turns the changes the traveler accepted into store operations: field updates on existing
 * activities (time, duration, day, order — nothing else, so notes, links and files stay) and
 * new "suggested" activities. Nothing is ever deleted.
 */

export type DayPlanPatch = Partial<Pick<Activity, "time" | "durationMin" | "dayId" | "sort_order">>;
export type DayPlanUpdate = { activityId: string; patch: DayPlanPatch };
export type DayPlanAddition = Omit<Activity, "id" | "tripId" | "userId">;
export type DayPlanOps = { updates: DayPlanUpdate[]; additions: DayPlanAddition[] };

type Entry = { original?: Activity; fromDayId?: string; dayId: string; time: string; durationMin: number; addition?: DayPlanAddition };

const byTime = (a: Entry, b: Entry) => (toMinutes(a.time) ?? Number.MAX_SAFE_INTEGER) - (toMinutes(b.time) ?? Number.MAX_SAFE_INTEGER);

export function planToOps(input: { days: TripDay[]; dayId: string; changes: GeniusChange[]; accepted: Set<string> }): DayPlanOps {
  const day = input.days.find((d) => d.id === input.dayId);
  if (!day) return { updates: [], additions: [] };
  const accepted = input.changes.filter((c) => input.accepted.has(c.key));
  const dayByDate = new Map(input.days.map((d) => [d.date, d]));

  const entries = new Map<string, Entry[]>();
  const touch = (target: TripDay) => {
    if (!entries.has(target.id)) {
      entries.set(target.id, target.activities.map((a) => ({ original: a, fromDayId: target.id, dayId: target.id, time: a.time, durationMin: a.durationMin })));
    }
    return entries.get(target.id)!;
  };
  const findEntry = (activityId: string) => touch(day).find((e) => e.original?.id === activityId);

  for (const change of accepted) {
    if (change.kind === "reschedule") {
      const entry = findEntry(change.activityId);
      if (entry) Object.assign(entry, { time: change.to.time, durationMin: change.to.durationMin });
    } else if (change.kind === "move_day") {
      const target = dayByDate.get(change.toDate);
      const list = touch(day);
      const index = list.findIndex((e) => e.original?.id === change.activityId);
      if (!target || index === -1) continue;
      const [entry] = list.splice(index, 1);
      touch(target).push({ ...entry, dayId: target.id, time: change.toTime });
    } else if (change.kind === "add") {
      const s = change.suggestion;
      touch(day).push({
        dayId: day.id,
        time: s.time,
        durationMin: s.durationMin,
        addition: {
          dayId: day.id,
          city: day.city,
          title: s.title,
          time: s.time,
          durationMin: s.durationMin,
          category: s.category,
          ...(s.location ? { location: s.location } : {}),
          ...(s.notes ? { notes: s.notes } : {}),
          priority: "medium",
          state: "pending",
          sort_order: 0,
          origin: "suggested",
        },
      });
    }
  }

  const updates: DayPlanUpdate[] = [];
  const additions: DayPlanAddition[] = [];
  for (const list of entries.values()) {
    [...list].sort(byTime).forEach((entry, index) => {
      if (entry.addition) {
        additions.push({ ...entry.addition, sort_order: index });
        return;
      }
      const original = entry.original!;
      const patch: DayPlanPatch = {};
      if (entry.time !== original.time) patch.time = entry.time;
      if (entry.durationMin !== original.durationMin) patch.durationMin = entry.durationMin;
      if (entry.dayId !== entry.fromDayId) patch.dayId = entry.dayId;
      if (index !== original.sort_order) patch.sort_order = index;
      if (Object.keys(patch).length > 0) updates.push({ activityId: original.id, patch });
    });
  }
  return { updates, additions };
}
