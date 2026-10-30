import { ACTIVITY_BUFFER_MIN, anchorsFor, toMinutes, toTime } from "@/lib/bookings/plan";
import type { Activity } from "@/lib/types";

/**
 * Times for an activity that the traveler moves on the timeline. Bookings keep their time:
 * only the moved activity changes, so it fits in the gap where it was dropped.
 */

const STEP_MIN = 5;
const LAST_MINUTE = 23 * 60 + 59;

/** A booking is a commitment (a flight, a ticket, a car pickup); a stay's check-in/out is a limit, not a fixed time. */
export function isFixedTime(activity: Activity): boolean {
  const booking = activity.origin === "booking" ? activity.booking : undefined;
  if (booking) return booking.role !== "check_in" && booking.role !== "check_out";
  return activity.category === "reservation";
}

/** Booked limits of a stay: check-out no later than its time, check-in no earlier. */
function limitsOf(activity: Activity): { earliest?: number; latest?: number } {
  const booking = activity.origin === "booking" ? activity.booking : undefined;
  if (booking?.role === "check_out") {
    const latest = toMinutes(booking.end?.time);
    return latest === null ? {} : { latest };
  }
  if (booking?.role === "check_in") {
    const earliest = toMinutes(booking.start?.time);
    return earliest === null ? {} : { earliest };
  }
  return {};
}

/** Blocked window on `date` (margins included), plus the walk or ride to whatever comes next. */
function windowOf(activity: Activity, date: string): { start: number; end: number } | null {
  const anchors = anchorsFor(activity, date).filter((anchor) => anchor.date === date);
  if (!anchors.length) return null;
  const start = Math.min(...anchors.map((anchor) => anchor.startMin));
  const end = Math.max(...anchors.map((anchor) => toMinutes(anchor.end)!));
  // Plain activities already carry ACTIVITY_BUFFER_MIN in their window; bookings end at a hard edge.
  return { start, end: end + (anchors[0].kind === "booking" ? ACTIVITY_BUFFER_MIN : 0) };
}

/** How far the window of `activity` starts and ends from its own time. */
function offsetsOf(activity: Activity, date: string) {
  const window = windowOf({ ...activity, time: "12:00" }, date);
  return window ? { before: 720 - window.start, after: window.end - 720 } : null;
}

/** Latest time at which `activity` is done (with its margins) before `next` needs the traveler. */
export function latestTimeBefore(activity: Activity, next: Activity, date: string): number | null {
  const offsets = offsetsOf(activity, date);
  const nextWindow = windowOf(next, date);
  if (!offsets || !nextWindow) return null;
  return Math.floor((nextWindow.start - offsets.after) / STEP_MIN) * STEP_MIN;
}

/** Earliest time at which `activity` can start once `previous` is over. */
export function earliestTimeAfter(activity: Activity, previous: Activity, date: string): number | null {
  const offsets = offsetsOf(activity, date);
  const previousWindow = windowOf(previous, date);
  if (!offsets || !previousWindow) return null;
  return Math.ceil((previousWindow.end + offsets.before) / STEP_MIN) * STEP_MIN;
}

export type MoveResult =
  | { kind: "moved"; time: string }
  | { kind: "fixed" }
  | { kind: "beyond_limit"; limit: string }
  | { kind: "unchanged" };

/**
 * The new time for `movedId` when it is dropped on `overId` in `order` (the timeline as shown).
 * Moving up, it ends before the activity it lands above; moving down, it starts after the one it lands below.
 */
export function timeForMove(order: Activity[], movedId: string, overId: string, date: string): MoveResult {
  const from = order.findIndex((activity) => activity.id === movedId);
  const to = order.findIndex((activity) => activity.id === overId);
  if (from === -1 || to === -1 || from === to) return { kind: "unchanged" };
  const moved = order[from];
  if (isFixedTime(moved)) return { kind: "fixed" };

  const movedUp = to < from;
  const neighbor = order[to];
  const minutes = movedUp ? latestTimeBefore(moved, neighbor, date) : earliestTimeAfter(moved, neighbor, date);
  if (minutes === null) return { kind: "unchanged" };

  // Moving up any earlier time still fits, moving down any later one: clamp to the booked limit
  // in that direction, and refuse only when the gap lies past the limit.
  const { earliest, latest } = limitsOf(moved);
  let time = minutes;
  if (movedUp && latest !== undefined) time = Math.min(time, latest);
  if (!movedUp && earliest !== undefined) time = Math.max(time, earliest);
  if (latest !== undefined && time > latest) return { kind: "beyond_limit", limit: toTime(latest) };
  if (earliest !== undefined && time < earliest) return { kind: "beyond_limit", limit: toTime(earliest) };
  return { kind: "moved", time: toTime(Math.min(Math.max(time, 0), LAST_MINUTE)) };
}

const DEPARTURES: ReadonlySet<string> = new Set(["flight", "train", "ferry", "bus", "transfer"]);

export type CheckoutClash = { checkout: Activity; departure: Activity; time: string };

/**
 * Check-outs that would still be going on when the traveler must already be at the airport,
 * station or port for a departure that day, with the latest time that leaves room for it.
 */
export function checkoutClashes(activities: Activity[], date: string): CheckoutClash[] {
  const clashes: CheckoutClash[] = [];
  for (const checkout of activities) {
    if (checkout.origin !== "booking" || checkout.booking?.role !== "check_out") continue;
    const checkoutTime = toMinutes(checkout.time);
    if (checkoutTime === null) continue;
    for (const departure of activities) {
      if (departure.origin !== "booking" || !DEPARTURES.has(departure.booking?.type ?? "")) continue;
      const window = windowOf(departure, date);
      const latest = latestTimeBefore(checkout, departure, date);
      // Past the end of the trip the check-out is at the destination, not a clash.
      if (!window || latest === null || latest < 0 || checkoutTime <= latest || checkoutTime >= window.end) continue;
      clashes.push({ checkout, departure, time: toTime(latest) });
    }
  }
  return clashes;
}
