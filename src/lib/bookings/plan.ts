import type { Activity, BookingRole, BookingType, TripDay } from "@/lib/types";

/**
 * Pure planning helpers for "Generate itinerary": they turn the trip's existing activities
 * (confirmed bookings and manual/accepted ones) into fixed anchors, derive the free windows
 * where the existing importer may propose activities, and validate its proposals.
 *
 * Travel times between places are NOT computed: the app has no reliable routing data, so
 * only fixed safety margins around commitments are used. The model is asked to group nearby
 * places instead of estimating precise transfers.
 */

export type DayDensity = "light" | "balanced" | "full";

export type PlanningAnchor = {
  activityId: string;
  title: string;
  kind: "booking" | "activity";
  bookingType?: BookingType;
  role?: BookingRole;
  /** Blocked window "HH:mm", margins included. */
  start: string;
  end: string;
  location?: string;
};

export type PlanningDay = {
  date: string;
  city: string;
  anchors: PlanningAnchor[];
  freeWindows: { start: string; end: string }[];
  maxSuggestions: number;
};

export type PlanningContext = {
  tripName: string;
  startDate?: string;
  endDate?: string;
  density: DayDensity;
  preferences?: { minimizeWalking?: boolean };
  days: PlanningDay[];
};

export type Proposal = {
  title: string;
  category: string;
  location?: string;
  date: string;
  time: string;
  durationMin: number;
  notes?: string;
};

export type ProposalConflictReason = "outside_trip" | "invalid_time" | "outside_free_window" | "over_day_limit";

export type FeasibilityAlternative = "lighter_density" | "skip_blocked_days" | "free_up_time";

/** Maximum suggestions per day for each density. */
export const MAX_SUGGESTIONS_BY_DENSITY: Record<DayDensity, number> = { light: 2, balanced: 3, full: 5 };

/** Airport arrival before a flight departure (check-in, security, boarding). */
export const FLIGHT_DEPARTURE_MARGIN_MIN = 120;
/** Baggage claim and leaving the airport after a flight lands. */
export const FLIGHT_ARRIVAL_MARGIN_MIN = 60;
/** Station/port arrival before, and exit after, a ground or sea transport. */
export const GROUND_TRANSPORT_MARGIN_MIN = 30;
/** Paperwork and vehicle inspection around a car pickup or drop-off (both sides). */
export const CAR_HANDOVER_MARGIN_MIN = 30;
/** Time needed to check in at the accommodation, starting at the check-in time. */
export const CHECK_IN_MARGIN_MIN = 30;
/** Packing and leaving the accommodation before the check-out time. */
export const CHECK_OUT_MARGIN_MIN = 30;
/** Buffer after any other existing activity. */
export const ACTIVITY_BUFFER_MIN = 15;
/** Free windows shorter than this are not worth proposing anything in. */
export const MIN_FREE_WINDOW_MIN = 60;

const DEFAULT_DAY_START = "09:00";
const DEFAULT_DAY_END = "21:30";
const LAST_MINUTE = 23 * 60 + 59;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GROUND_TRANSPORT: ReadonlySet<BookingType> = new Set(["train", "ferry", "bus", "transfer"]);

export function toMinutes(time: string | undefined): number | null {
  if (!time || !TIME_RE.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function toTime(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), LAST_MINUTE);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

type Interval = { start: number; end: number };

export type DraftAnchor = PlanningAnchor & { date: string; startMin: number };

function anchorBase(activity: Activity): Omit<PlanningAnchor, "start" | "end"> {
  const booking = activity.origin === "booking" ? activity.booking : undefined;
  return {
    activityId: activity.id,
    title: activity.title,
    kind: booking ? "booking" : "activity",
    ...(booking ? { bookingType: booking.type, role: booking.role } : {}),
    ...(activity.location ? { location: activity.location } : {}),
  };
}

/** Blocked windows produced by one activity; an overnight transport also blocks its arrival day. */
export function anchorsFor(activity: Activity, date: string): DraftAnchor[] {
  const time = toMinutes(activity.time);
  // Without a valid local time the activity cannot be placed on the timeline.
  if (time === null) return [];
  const base = anchorBase(activity);
  const make = (onDate: string, start: number, end: number): DraftAnchor => ({
    ...base,
    date: onDate,
    startMin: start,
    start: toTime(start),
    end: toTime(end),
  });
  const booking = base.kind === "booking" ? activity.booking : undefined;
  const duration = Math.max(0, Number.isFinite(activity.durationMin) ? activity.durationMin : 0);

  if (booking?.type === "flight" || (booking && GROUND_TRANSPORT.has(booking.type))) {
    const isFlight = booking.type === "flight";
    const before = isFlight ? FLIGHT_DEPARTURE_MARGIN_MIN : GROUND_TRANSPORT_MARGIN_MIN;
    const after = isFlight ? FLIGHT_ARRIVAL_MARGIN_MIN : GROUND_TRANSPORT_MARGIN_MIN;
    const arrivalDate = booking.end?.date;
    const arrivalTime = toMinutes(booking.end?.time);
    if (arrivalDate && arrivalDate !== date && arrivalTime !== null) {
      // Overnight: blocked from the departure margin to midnight, then until arrival + margin.
      return [make(date, time - before, LAST_MINUTE), make(arrivalDate, 0, arrivalTime + after)];
    }
    // Same day: the local arrival time wins over time + duration (time zones may differ).
    const arrival = arrivalTime ?? time + duration;
    return [make(date, time - before, arrival + after)];
  }
  if (booking?.role === "pickup" || booking?.role === "dropoff") {
    return [make(date, time - CAR_HANDOVER_MARGIN_MIN, time + CAR_HANDOVER_MARGIN_MIN)];
  }
  if (booking?.role === "check_in") return [make(date, time, time + CHECK_IN_MARGIN_MIN)];
  if (booking?.role === "check_out") return [make(date, time - CHECK_OUT_MARGIN_MIN, time)];
  return [make(date, time, time + duration + ACTIVITY_BUFFER_MIN)];
}

function freeWindowsFor(blocked: Interval[], dayStart: number, dayEnd: number): { start: string; end: string }[] {
  const windows: { start: string; end: string }[] = [];
  let cursor = dayStart;
  const sorted = [...blocked].sort((a, b) => a.start - b.start);
  for (const interval of sorted) {
    if (interval.start > cursor && Math.min(interval.start, dayEnd) - cursor >= MIN_FREE_WINDOW_MIN) {
      windows.push({ start: toTime(cursor), end: toTime(Math.min(interval.start, dayEnd)) });
    }
    cursor = Math.max(cursor, interval.end);
    if (cursor >= dayEnd) return windows;
  }
  if (dayEnd - cursor >= MIN_FREE_WINDOW_MIN) windows.push({ start: toTime(cursor), end: toTime(dayEnd) });
  return windows;
}

export function buildPlanningContext(input: {
  tripName: string;
  startDate?: string;
  endDate?: string;
  days: TripDay[];
  density: DayDensity;
  preferences?: { minimizeWalking?: boolean };
  dayStart?: string;
  dayEnd?: string;
}): PlanningContext {
  const dayStart = toMinutes(input.dayStart) ?? toMinutes(DEFAULT_DAY_START)!;
  const dayEnd = toMinutes(input.dayEnd) ?? toMinutes(DEFAULT_DAY_END)!;
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));

  const anchorsByDate = new Map<string, DraftAnchor[]>(days.map((d) => [d.date, []]));
  for (const tripDay of days) {
    for (const activity of tripDay.activities) {
      for (const anchor of anchorsFor(activity, tripDay.date)) anchorsByDate.get(anchor.date)?.push(anchor);
    }
  }

  const cap = MAX_SUGGESTIONS_BY_DENSITY[input.density] ?? MAX_SUGGESTIONS_BY_DENSITY.balanced;
  return {
    tripName: input.tripName,
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
    density: input.density,
    ...(input.preferences ? { preferences: { ...input.preferences } } : {}),
    days: days.map((tripDay) => {
      const drafts = [...(anchorsByDate.get(tripDay.date) ?? [])].sort((a, b) => a.startMin - b.startMin);
      const blocked = drafts.map((a) => ({ start: a.startMin, end: toMinutes(a.end)! }));
      const hasFlight = drafts.some((a) => a.bookingType === "flight");
      const anchors = drafts.map((draft) => {
        const { date, startMin, ...anchor } = draft;
        void date;
        void startMin;
        return anchor;
      });
      return {
        date: tripDay.date,
        city: tripDay.city,
        anchors,
        freeWindows: freeWindowsFor(blocked, dayStart, dayEnd),
        maxSuggestions: hasFlight ? Math.max(0, Math.floor(cap / 2)) : cap,
      };
    }),
  };
}

export function validateProposals(
  proposals: Proposal[],
  context: PlanningContext,
): { valid: Proposal[]; conflicts: { proposal: Proposal; reason: ProposalConflictReason }[] } {
  const daysByDate = new Map(context.days.map((d) => [d.date, d]));
  const conflicts: { proposal: Proposal; reason: ProposalConflictReason }[] = [];
  const candidates: { proposal: Proposal; start: number; end: number }[] = [];

  for (const proposal of proposals) {
    if (!daysByDate.has(proposal.date)) {
      conflicts.push({ proposal, reason: "outside_trip" });
      continue;
    }
    const start = toMinutes(proposal.time);
    if (start === null || !Number.isFinite(proposal.durationMin) || proposal.durationMin <= 0) {
      conflicts.push({ proposal, reason: "invalid_time" });
      continue;
    }
    candidates.push({ proposal, start, end: start + proposal.durationMin });
  }

  candidates.sort((a, b) => a.proposal.date.localeCompare(b.proposal.date) || a.start - b.start);
  const valid: Proposal[] = [];
  const acceptedByDate = new Map<string, Interval[]>();
  for (const { proposal, start, end } of candidates) {
    const day = daysByDate.get(proposal.date)!;
    const accepted = acceptedByDate.get(proposal.date) ?? [];
    const insideWindow = day.freeWindows.some((w) => start >= toMinutes(w.start)! && end <= toMinutes(w.end)!);
    // Accepted proposals consume their part of the free window.
    const overlapsAccepted = accepted.some((a) => start < a.end && a.start < end);
    if (!insideWindow || overlapsAccepted) {
      conflicts.push({ proposal, reason: "outside_free_window" });
    } else if (accepted.length >= day.maxSuggestions) {
      conflicts.push({ proposal, reason: "over_day_limit" });
    } else {
      accepted.push({ start, end });
      acceptedByDate.set(proposal.date, accepted);
      valid.push(proposal);
    }
  }
  return { valid, conflicts };
}

export function assessFeasibility(context: PlanningContext): {
  feasible: boolean;
  blockedDays: string[];
  alternatives: FeasibilityAlternative[];
} {
  const blockedDays = context.days.filter((d) => d.freeWindows.length === 0).map((d) => d.date);
  const feasible = context.days.length > 0 && blockedDays.length < context.days.length;
  // A lighter density never creates free time, so it is not offered for a fully blocked trip.
  const alternatives: FeasibilityAlternative[] = !feasible
    ? ["free_up_time"]
    : blockedDays.length > 0
      ? ["skip_blocked_days"]
      : [];
  return { feasible, blockedDays, alternatives };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Maps the text importer's `{ activities: [...] }` output to proposals; malformed items are dropped, never completed. */
export function proposalsFromImporter(raw: unknown): Proposal[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { activities?: unknown }).activities;
  if (!Array.isArray(items)) return [];

  const proposals: Proposal[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = nonEmptyString(record.title);
    const date = nonEmptyString(record.date);
    const time = nonEmptyString(record.time);
    const duration = record.duration_minutes;
    if (!title || !date || !DATE_RE.test(date) || !time || !TIME_RE.test(time)) continue;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) continue;
    const location = nonEmptyString(record.location);
    const notes = nonEmptyString(record.notes);
    proposals.push({
      title,
      // "other" is the importer schema's own neutral category, not an invented fact.
      category: nonEmptyString(record.category) ?? "other",
      ...(location ? { location } : {}),
      date,
      time,
      durationMin: Math.round(duration),
      ...(notes ? { notes } : {}),
    });
  }
  return proposals;
}
