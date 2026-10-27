import { toMinutes } from "@/lib/bookings/plan";
import type { GeniusContext, GeniusMovable } from "@/lib/day-genius/context";
import type { ActivityCategory } from "@/lib/types";

/**
 * Deterministic checks on the model's proposal: only known activities, nothing before the
 * current time or after the end of the day, nothing on top of a booking or another activity,
 * moves only into another day's free time. Whatever breaks a rule is dropped and reported.
 */

export type GeniusSuggestion = {
  title: string;
  category: ActivityCategory;
  location?: string;
  time: string;
  durationMin: number;
  notes?: string;
};

export type GeniusChange =
  | {
      key: string;
      kind: "reschedule";
      activityId: string;
      title: string;
      from: { time: string; durationMin: number };
      to: { time: string; durationMin: number };
      reason: string;
    }
  | { key: string; kind: "move_day"; activityId: string; title: string; fromTime: string; toDate: string; toTime: string; reason: string }
  | { key: string; kind: "add"; suggestion: GeniusSuggestion; replacesId?: string; reason: string }
  | { key: string; kind: "unplaced"; activityId: string; title: string; reason: string };

export type GeniusRejectionReason =
  | "unknown_id"
  | "duplicate"
  | "invalid_time"
  | "before_window"
  | "after_day_end"
  | "overlap"
  | "invalid_day"
  | "outside_free_time"
  | "invalid_category"
  | "too_many";

export type GeniusRejection = { ref: string; reason: GeniusRejectionReason };

export type GeniusPlan = { summary: string; changes: GeniusChange[]; rejected: GeniusRejection[] };

export const MAX_GENIUS_SUGGESTIONS = 3;
const MAX_DURATION_MIN = 12 * 60;
const MAX_TEXT = 300;
const CATEGORIES: readonly ActivityCategory[] = ["sightseeing", "reservation", "transport", "hotel", "food", "shopping", "photos", "nightlife", "other"];

type Interval = { start: number; end: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const str = (value: unknown, max = MAX_TEXT) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

function slotOf(time: string, durationMin: number): Interval | null {
  const start = toMinutes(time);
  return start === null ? null : { start, end: start + durationMin };
}

function duration(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_DURATION_MIN ? value : null;
}

/** Today's timeline for one set of accepted changes; keyed entries belong to a change. */
function todayIntervals(context: GeniusContext, changes: GeniusChange[], accepted: Set<string>) {
  const entries: (Interval & { key?: string })[] = [];
  for (const block of context.fixed) {
    const slot = slotOf(block.start, 0);
    const end = toMinutes(block.end);
    if (slot && end !== null) entries.push({ start: slot.start, end });
  }
  const acceptedFor = (activityId: string) =>
    changes.find((c) => accepted.has(c.key) && (c.kind === "reschedule" || c.kind === "move_day") && c.activityId === activityId);
  for (const movable of context.movable) {
    const change = acceptedFor(movable.id);
    if (change?.kind === "move_day") continue;
    if (change?.kind === "reschedule") {
      const slot = slotOf(change.to.time, change.to.durationMin);
      if (slot) entries.push({ ...slot, key: change.key });
      continue;
    }
    // Unchanged: an overdue activity's slot is already in the past.
    const slot = movable.status === "upcoming" ? slotOf(movable.time, movable.durationMin) : null;
    if (slot) entries.push(slot);
  }
  for (const change of changes) {
    if (change.kind !== "add" || !accepted.has(change.key)) continue;
    const slot = slotOf(change.suggestion.time, change.suggestion.durationMin);
    if (slot) entries.push({ ...slot, key: change.key });
  }
  return entries;
}

/** Keys of accepted changes that collide with something else once applied together. */
export function geniusConflicts(context: GeniusContext, changes: GeniusChange[], accepted: Set<string>): Set<string> {
  const conflicts = new Set<string>();
  const entries = todayIntervals(context, changes, accepted);
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (!overlaps(entries[i], entries[j])) continue;
      if (entries[i].key) conflicts.add(entries[i].key!);
      if (entries[j].key) conflicts.add(entries[j].key!);
    }
  }
  const moves = changes.filter((c): c is Extract<GeniusChange, { kind: "move_day" }> => c.kind === "move_day" && accepted.has(c.key));
  for (let i = 0; i < moves.length; i += 1) {
    for (let j = i + 1; j < moves.length; j += 1) {
      if (moves[i].toDate !== moves[j].toDate) continue;
      const a = slotOf(moves[i].toTime, durationOf(context, moves[i].activityId));
      const b = slotOf(moves[j].toTime, durationOf(context, moves[j].activityId));
      if (a && b && overlaps(a, b)) {
        conflicts.add(moves[i].key);
        conflicts.add(moves[j].key);
      }
    }
  }
  return conflicts;
}

function durationOf(context: GeniusContext, activityId: string): number {
  return context.movable.find((m) => m.id === activityId)?.durationMin ?? 0;
}

export function validateGeniusPlan(context: GeniusContext, raw: unknown): GeniusPlan {
  const plan = isRecord(raw) ? raw : {};
  const changes: GeniusChange[] = [];
  const rejected: GeniusRejection[] = [];
  const reject = (ref: string, reason: GeniusRejectionReason) => rejected.push({ ref, reason });
  const movableById = new Map(context.movable.map((m) => [m.id, m]));
  const handled = new Set<string>();
  const windowStart = toMinutes(context.windowStart)!;
  const dayEnd = toMinutes(context.dayEnd)!;

  const claim = (rawId: unknown): GeniusMovable | null => {
    const id = str(rawId, 200);
    const movable = movableById.get(id);
    if (!movable) {
      reject(id, "unknown_id");
      return null;
    }
    if (handled.has(id)) {
      reject(id, "duplicate");
      return null;
    }
    handled.add(id);
    return movable;
  };

  const timing = (ref: string, time: unknown, minutes: number | null): Interval | null => {
    const slot = typeof time === "string" && minutes !== null ? slotOf(time, minutes) : null;
    if (!slot) return (reject(ref, "invalid_time"), null);
    if (slot.start < windowStart) return (reject(ref, "before_window"), null);
    if (slot.end > dayEnd) return (reject(ref, "after_day_end"), null);
    return slot;
  };

  // Today's new times: checked for format and window first, then placed in time order.
  const scheduled: { movable: GeniusMovable; slot: Interval; time: string; durationMin: number; reason: string }[] = [];
  for (const entry of list(plan.schedule)) {
    const movable = claim(entry.id);
    if (!movable) continue;
    const durationMin = duration(entry.duration_minutes) ?? movable.durationMin;
    const slot = timing(movable.id, entry.time, durationMin);
    if (slot) scheduled.push({ movable, slot, time: entry.time as string, durationMin, reason: str(entry.reason) });
  }

  for (const entry of list(plan.move_to_other_day)) {
    const movable = claim(entry.id);
    if (!movable) continue;
    const target = context.otherDays.find((d) => d.date === entry.date);
    if (!target) {
      reject(movable.id, "invalid_day");
      continue;
    }
    const slot = typeof entry.time === "string" ? slotOf(entry.time, movable.durationMin) : null;
    if (!slot) {
      reject(movable.id, "invalid_time");
      continue;
    }
    const fits = target.freeWindows.some((w) => slot.start >= toMinutes(w.start)! && slot.end <= toMinutes(w.end)!);
    if (!fits) {
      reject(movable.id, "outside_free_time");
      continue;
    }
    changes.push({
      key: `m:${movable.id}`,
      kind: "move_day",
      activityId: movable.id,
      title: movable.title,
      fromTime: movable.time,
      toDate: target.date,
      toTime: entry.time as string,
      reason: str(entry.reason),
    });
  }

  for (const entry of list(plan.unplaced)) {
    const movable = claim(entry.id);
    if (!movable) continue;
    changes.push({ key: `u:${movable.id}`, kind: "unplaced", activityId: movable.id, title: movable.title, reason: str(entry.reason) });
  }

  // Everything that keeps its current slot today blocks that time.
  const movedAway = new Set(changes.filter((c) => c.kind === "move_day").map((c) => (c as { activityId: string }).activityId));
  const rescheduledIds = new Set(scheduled.map((s) => s.movable.id));
  const occupied: Interval[] = context.fixed.map((b) => ({ start: toMinutes(b.start)!, end: toMinutes(b.end)! }));
  for (const movable of context.movable) {
    if (movedAway.has(movable.id) || rescheduledIds.has(movable.id) || movable.status !== "upcoming") continue;
    const slot = slotOf(movable.time, movable.durationMin);
    if (slot) occupied.push(slot);
  }

  for (const item of [...scheduled].sort((a, b) => a.slot.start - b.slot.start)) {
    if (occupied.some((o) => overlaps(o, item.slot))) {
      reject(item.movable.id, "overlap");
      // It keeps its current slot instead.
      const original = item.movable.status === "upcoming" ? slotOf(item.movable.time, item.movable.durationMin) : null;
      if (original) occupied.push(original);
      continue;
    }
    occupied.push(item.slot);
    if (item.time === item.movable.time && item.durationMin === item.movable.durationMin) continue;
    changes.push({
      key: `r:${item.movable.id}`,
      kind: "reschedule",
      activityId: item.movable.id,
      title: item.movable.title,
      from: { time: item.movable.time, durationMin: item.movable.durationMin },
      to: { time: item.time, durationMin: item.durationMin },
      reason: item.reason,
    });
  }

  let added = 0;
  list(plan.suggestions).forEach((entry, index) => {
    const title = str(entry.title, 120);
    const ref = title || `suggestion ${index + 1}`;
    if (!title) return reject(ref, "invalid_time");
    const category = CATEGORIES.find((c) => c === entry.category);
    if (!category) return reject(ref, "invalid_category");
    const durationMin = duration(entry.duration_minutes);
    const slot = timing(ref, entry.time, durationMin);
    if (!slot) return;
    if (added >= MAX_GENIUS_SUGGESTIONS) return reject(ref, "too_many");
    if (occupied.some((o) => overlaps(o, slot))) return reject(ref, "overlap");
    occupied.push(slot);
    added += 1;
    const location = str(entry.location, 200);
    const notes = str(entry.notes, 500);
    const replacesId = str(entry.replaces_id, 200);
    changes.push({
      key: `a:${index}`,
      kind: "add",
      suggestion: { title, category, ...(location ? { location } : {}), time: entry.time as string, durationMin: durationMin!, ...(notes ? { notes } : {}) },
      ...(movableById.has(replacesId) ? { replacesId } : {}),
      reason: str(entry.reason),
    });
  });

  // A rejected entry keeps its old slot, which may collide with something accepted earlier.
  let result = changes;
  for (let guard = 0; guard < changes.length; guard += 1) {
    const conflicts = geniusConflicts(context, result, new Set(result.map((c) => c.key)));
    if (conflicts.size === 0) break;
    const [first] = conflicts;
    const dropped = result.find((c) => c.key === first)!;
    reject("activityId" in dropped ? dropped.activityId : dropped.suggestion.title, "overlap");
    result = result.filter((c) => c.key !== first);
  }

  return { summary: str(plan.summary, 500), changes: [...result].sort(byDisplayOrder), rejected };
}

const KIND_ORDER: Record<GeniusChange["kind"], number> = { reschedule: 0, add: 0, move_day: 1, unplaced: 2 };

/** Today's timeline first (by new time), then what goes to another day, then what does not fit. */
function byDisplayOrder(a: GeniusChange, b: GeniusChange): number {
  const time = (c: GeniusChange) => (c.kind === "reschedule" ? c.to.time : c.kind === "add" ? c.suggestion.time : c.kind === "move_day" ? `${c.toDate}T${c.toTime}` : "");
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || time(a).localeCompare(time(b));
}
