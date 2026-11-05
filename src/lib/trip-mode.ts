import type { Activity, TripDay, TripPlan } from "@/lib/types";

/** How the itinerary presents a trip relative to today. */
export type TripMode = "planning" | "today" | "memory";

type DatedTrip = Pick<TripPlan, "startDate" | "endDate" | "days">;

const isDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}/.test(value);

/** The trip's range: its own dates, else the first and last day dates. */
export function tripDateRange(trip: DatedTrip): { start?: string; end?: string } {
  const dayDates = trip.days.map((day) => day.date).filter(isDate).sort();
  const start = isDate(trip.startDate) ? trip.startDate.slice(0, 10) : dayDates[0]?.slice(0, 10);
  const end = isDate(trip.endDate) ? trip.endDate.slice(0, 10) : dayDates.at(-1)?.slice(0, 10);
  return { start, end: end ?? start };
}

/** `today` is "yyyy-MM-dd". A trip without any dates is still being planned. */
export function tripMode(trip: DatedTrip, today: string): TripMode {
  const { start, end } = tripDateRange(trip);
  if (!start) return "planning";
  if (today < start) return "planning";
  if (end && today > end) return "memory";
  return "today";
}

/** Calendar days from `today` to the trip's start, or null when it has no dates. */
export function daysUntilStart(trip: DatedTrip, today: string): number | null {
  const { start } = tripDateRange(trip);
  if (!start) return null;
  const toUtc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((toUtc(start) - toUtc(today)) / 86_400_000);
}

const toMinutes = (time: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * What is happening on `day` at `nowHHmm`: `now` is a pending activity whose time window
 * [start, start + duration) contains now (an activity without duration only at its start
 * minute); `next` is the first pending activity starting after now. Completed and skipped
 * activities, and activities without a time, are ignored.
 */
export function nowNext(day: Pick<TripDay, "activities">, nowHHmm: string): { now?: Activity; next?: Activity } {
  const nowMin = toMinutes(nowHHmm);
  if (nowMin === null) return { now: undefined, next: undefined };
  const timed = day.activities
    .filter((activity) => activity.state !== "completed" && activity.state !== "skipped")
    .map((activity) => ({ activity, start: toMinutes(activity.time) }))
    .filter((item): item is { activity: Activity; start: number } => item.start !== null)
    .sort((a, b) => a.start - b.start);

  let now: Activity | undefined;
  for (const { activity, start } of timed) {
    const end = start + Math.max(0, activity.durationMin ?? 0);
    if (start <= nowMin && (nowMin < end || nowMin === start)) now = activity;
  }
  const next = timed.find(({ start }) => start > nowMin)?.activity;
  return { now, next };
}
