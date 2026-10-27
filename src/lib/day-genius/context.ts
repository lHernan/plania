import { anchorsFor, buildPlanningContext, toMinutes, toTime } from "@/lib/bookings/plan";
import { getCurrentTripDateTime } from "@/lib/travel-context";
import type { Activity, ActivityCategory, Priority, TravelContext, TripDay } from "@/lib/types";

/**
 * Pure context builder for "Day genius": it splits the day into what is fixed (confirmed
 * bookings with their margins, the activity the traveler is probably still doing) and what
 * can be reorganized, from the current local time on. Travel times are straight-line
 * estimates from geocoded coordinates, never real routes.
 */

export type GeniusNow = { date: string; time: string };
export type Coords = { lat: number; lng: number };

export type GeniusBlock = {
  id: string;
  title: string;
  /** booking: confirmed commitment (margins included); ongoing: assumed in progress until now. */
  kind: "booking" | "ongoing";
  start: string;
  end: string;
  location?: string;
};

export type GeniusMovable = {
  id: string;
  title: string;
  category: ActivityCategory;
  priority: Priority;
  location?: string;
  time: string;
  durationMin: number;
  /** overdue: its planned start already passed today. */
  status: "upcoming" | "overdue";
  hasReservation?: boolean;
};

export type TravelEstimate = { from: string; to: string; km: number; minutes: number; mode: "walk" | "ride" };

export type GeniusOtherDay = { date: string; city: string; freeWindows: { start: string; end: string }[] };

export type GeniusContext = {
  date: string;
  city: string;
  mode: "today" | "future";
  /** Current local time, only when the day is today. */
  now?: string;
  /** Nothing may start before this time. */
  windowStart: string;
  /** Nothing may end after this time. */
  dayEnd: string;
  fixed: GeniusBlock[];
  movable: GeniusMovable[];
  travel: TravelEstimate[];
  otherDays: GeniusOtherDay[];
};

/** no_place: nothing planned and no real city or located booking to suggest plans near. */
export type GeniusUnavailableReason = "past_day" | "no_place" | "day_over";

export type GeniusContextResult = { ok: true; context: GeniusContext } | { ok: false; reason: GeniusUnavailableReason };

const EARLIEST_START = "08:00";
const DEFAULT_DAY_END = "22:00";
const LAST_MINUTE = 23 * 60 + 59;
/** Less than this before the end of the day is not worth reorganizing. */
const MIN_REMAINING_MIN = 30;
/** Up to this distance a transfer is assumed on foot. */
const WALK_MAX_KM = 1.2;
const WALK_KMH = 4.5;
const RIDE_KMH = 35;
/** Parking, waiting, getting in and out. */
const RIDE_OVERHEAD_MIN = 10;
/** Straight lines underestimate real paths. */
const DETOUR_FACTOR = 1.3;

/** Empty or the default name a new day gets before the traveler sets one. */
export function isPlaceholderCity(city: string): boolean {
  const c = city.trim().toLowerCase();
  return !c || c === "new destination" || c === "new city";
}

const isMovable = (activity: Activity) =>
  activity.origin !== "booking" && (activity.state === "pending" || activity.state === "delayed");

export function haversineKm(a: Coords, b: Coords): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function estimateTravel(from: Coords, to: Coords): Pick<TravelEstimate, "km" | "minutes" | "mode"> {
  const km = Math.round(haversineKm(from, to) * 10) / 10;
  if (km <= WALK_MAX_KM) {
    return { km, mode: "walk", minutes: Math.max(1, Math.ceil(((km * DETOUR_FACTOR) / WALK_KMH) * 60)) };
  }
  return { km, mode: "ride", minutes: Math.ceil(RIDE_OVERHEAD_MIN + ((km * DETOUR_FACTOR) / RIDE_KMH) * 60) };
}

const isValidZone = (zone: string | undefined): zone is string =>
  !!zone && getCurrentTripDateTime(new Date(0), zone).timeZoneSource === "trip_context";

/**
 * Time zone of "now" for the trip: the travel context arrival, else the zone printed on a
 * booking (flight arrival first), else the device's zone.
 */
export function tripTimeZone(trip: { travelContext?: TravelContext | null; days: TripDay[] }, deviceZone: string): string {
  const fromContext = trip.travelContext?.arrival?.timeZone;
  if (isValidZone(fromContext)) return fromContext;
  for (const tripDay of trip.days) {
    for (const activity of tripDay.activities) {
      const booking = activity.origin === "booking" ? activity.booking : undefined;
      const zone = booking?.end?.timeZone ?? booking?.start?.timeZone;
      if (isValidZone(zone)) return zone;
    }
  }
  return deviceZone;
}

export function buildGeniusContext(input: {
  days: TripDay[];
  dayId: string;
  now: GeniusNow;
  coords?: Record<string, Coords>;
}): GeniusContextResult {
  const day = input.days.find((d) => d.id === input.dayId);
  if (!day || day.date < input.now.date) return { ok: false, reason: "past_day" };
  const isToday = day.date === input.now.date;
  const nowMin = toMinutes(input.now.time) ?? 0;

  const candidates = day.activities
    .filter(isMovable)
    .sort((a, b) => (toMinutes(a.time) ?? LAST_MINUTE) - (toMinutes(b.time) ?? LAST_MINUTE));

  // The first unfinished activity that already started is assumed to be in progress:
  // the traveler checks things off in order, so that is where they are now.
  const ongoing = isToday
    ? candidates.find((a) => {
        const start = toMinutes(a.time);
        return start !== null && start <= nowMin;
      })
    : undefined;
  const movableActivities = candidates.filter((a) => a !== ongoing);

  const fixed: GeniusBlock[] = [];
  // Bookings of any day may block this date (an overnight flight blocks its arrival day).
  for (const tripDay of input.days) {
    for (const activity of tripDay.activities) {
      if (activity.origin !== "booking") continue;
      for (const anchor of anchorsFor(activity, tripDay.date)) {
        if (anchor.date !== day.date) continue;
        fixed.push({
          id: activity.id,
          title: activity.title,
          kind: "booking",
          start: anchor.start,
          end: anchor.end,
          ...(activity.location ? { location: activity.location } : {}),
        });
      }
    }
  }
  if (ongoing) {
    const start = toMinutes(ongoing.time)!;
    fixed.push({
      id: ongoing.id,
      title: ongoing.title,
      kind: "ongoing",
      start: ongoing.time,
      end: toTime(Math.max(start + ongoing.durationMin, nowMin)),
      ...(ongoing.location ? { location: ongoing.location } : {}),
    });
  }
  fixed.sort((a, b) => a.start.localeCompare(b.start));
  const city = isPlaceholderCity(day.city) ? "" : day.city;
  // With nothing planned the genie suggests plans, which need somewhere to be near.
  if (movableActivities.length === 0 && !city && !fixed.some((f) => f.location)) return { ok: false, reason: "no_place" };

  const earliestPlanned = Math.min(...movableActivities.map((a) => toMinutes(a.time) ?? LAST_MINUTE));
  const earlyStart = Math.min(toMinutes(EARLIEST_START)!, earliestPlanned);
  const windowStart = isToday ? Math.max(Math.ceil(nowMin / 5) * 5, earlyStart) : earlyStart;
  const latestPlannedEnd = Math.max(...movableActivities.map((a) => (toMinutes(a.time) ?? 0) + a.durationMin));
  const dayEnd = Math.min(Math.max(toMinutes(DEFAULT_DAY_END)!, latestPlannedEnd), LAST_MINUTE);
  if (windowStart + MIN_REMAINING_MIN > dayEnd) return { ok: false, reason: "day_over" };

  const movable: GeniusMovable[] = movableActivities.map((a) => {
    const start = toMinutes(a.time);
    return {
      id: a.id,
      title: a.title,
      category: a.category,
      priority: a.priority,
      ...(a.location ? { location: a.location } : {}),
      time: a.time,
      durationMin: a.durationMin,
      status: isToday && start !== null && start < nowMin ? "overdue" : "upcoming",
      ...(a.reservationUrl || a.category === "reservation" ? { hasReservation: true } : {}),
    };
  });

  const coords = input.coords ?? {};
  const nodes = [...(ongoing ? [ongoing.id] : []), ...movable.map((m) => m.id), ...fixed.filter((f) => f.kind === "booking").map((f) => f.id)]
    .filter((id, index, all) => all.indexOf(id) === index && coords[id]);
  const travel: TravelEstimate[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      travel.push({ from: nodes[i], to: nodes[j], ...estimateTravel(coords[nodes[i]], coords[nodes[j]]) });
    }
  }

  const isLater = (date: string) => date > day.date && date > input.now.date;
  // This day goes in too, so an overnight booking that leaves today blocks its arrival on the next one.
  const otherDays = input.days.some((d) => isLater(d.date))
    ? buildPlanningContext({ tripName: "", days: input.days.filter((d) => d.date >= day.date), density: "full" })
        .days.filter((d) => isLater(d.date))
        .map((d) => ({ date: d.date, city: d.city, freeWindows: d.freeWindows }))
    : [];

  return {
    ok: true,
    context: {
      date: day.date,
      city,
      mode: isToday ? "today" : "future",
      ...(isToday ? { now: input.now.time } : {}),
      windowStart: toTime(windowStart),
      dayEnd: toTime(dayEnd),
      fixed,
      movable,
      travel,
      otherDays,
    },
  };
}
