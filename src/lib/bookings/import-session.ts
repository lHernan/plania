import type { Activity, ActivityCategory, BookingField, BookingMoment, TripDay } from "@/lib/types";
import type { NewActivity } from "@/store/use-itinerary-store";
import type { ExtractedBooking } from "./extract";
import { findBookingDuplicates, type BookingDuplicate } from "./dedupe";
import type { Proposal } from "./plan";
import { isValidIsoDate, isValidTime, isValidTimeZone, minutesBetween } from "./timezone";
import { bookingToActivities } from "./to-activities";

/**
 * Pure review-state helpers for "Import bookings": nothing here persists anything. The modal keeps
 * these items in memory until the user confirms, so cancelling never leaves a partial itinerary.
 */

export type ReviewItem = {
  /** The extracted booking id (unique within one import). */
  id: string;
  /** Local id of the file the booking was read from. */
  fileId: string;
  booking: ExtractedBooking;
  included: boolean;
  duplicate?: BookingDuplicate;
};

export type EditError = "invalid_date" | "invalid_time" | "invalid_time_zone" | "required";

export type ConfirmBlocker = { itemId: string; reason: "doubts" | "outside_trip" };

type Lang = "es" | "en";

type StringField = "title" | "provider" | "reference" | "from" | "to" | "address" | "pickupLocation" | "dropoffLocation";

const CATEGORIES: readonly ActivityCategory[] = [
  "sightseeing", "reservation", "transport", "hotel", "food", "shopping", "photos", "nightlife", "other",
];

export function createReviewItems(
  results: { fileId: string; bookings: ExtractedBooking[] }[],
  existingActivities: Activity[],
): ReviewItem[] {
  const all = results.flatMap((r) => r.bookings.map((booking) => ({ fileId: r.fileId, booking })));
  const duplicates = findBookingDuplicates(all.map((x) => x.booking), existingActivities);
  return all.map(({ fileId, booking }) => {
    const duplicate = duplicates[booking.id];
    return {
      id: booking.id,
      fileId,
      booking: { ...booking, warnings: [...booking.warnings], fieldStatus: { ...booking.fieldStatus } },
      included: !duplicate,
      ...(duplicate ? { duplicate } : {}),
    };
  });
}

function withConfirmed(booking: ExtractedBooking, fields: BookingField[]): ExtractedBooking {
  const current = booking.userConfirmedFields ?? [];
  const merged = [...current, ...fields.filter((f) => !current.includes(f))];
  return { ...booking, userConfirmedFields: merged };
}

function endsBeforeStart(start?: BookingMoment, end?: BookingMoment): boolean {
  if (!start?.date || !end?.date) return false;
  if (start.time && end.time) return minutesBetween(start, end) === null;
  return end.date < start.date;
}

function setMoment(booking: ExtractedBooking, key: "start" | "end", part: keyof BookingMoment, value: string): ExtractedBooking {
  const moment: BookingMoment = { ...(booking[key] ?? {}) };
  if (value) moment[part] = value;
  else delete moment[part];
  const next = { ...booking };
  if (Object.keys(moment).length) next[key] = moment;
  else delete next[key];
  return next;
}

/** Applies a user edit. Dates must be YYYY-MM-DD and times HH:mm; the field is recorded as user-confirmed. */
export function editBookingField(
  item: ReviewItem,
  field: BookingField,
  rawValue: string,
): { ok: true; item: ReviewItem } | { ok: false; error: EditError } {
  const value = rawValue.trim();
  let booking: ExtractedBooking = item.booking;

  if (field === "title" || field === "startDate") {
    if (!value) return { ok: false, error: "required" };
  }
  if ((field === "startDate" || field === "endDate") && value && !isValidIsoDate(value)) {
    return { ok: false, error: "invalid_date" };
  }
  if ((field === "startTime" || field === "endTime") && value && !isValidTime(value)) {
    return { ok: false, error: "invalid_time" };
  }
  if (field === "timeZone" && value && !isValidTimeZone(value)) {
    return { ok: false, error: "invalid_time_zone" };
  }

  switch (field) {
    case "startDate":
      booking = setMoment(booking, "start", "date", value);
      break;
    case "startTime":
      booking = setMoment(booking, "start", "time", value);
      break;
    case "endDate":
      booking = setMoment(booking, "end", "date", value);
      break;
    case "endTime":
      booking = setMoment(booking, "end", "time", value);
      break;
    case "timeZone":
      booking = setMoment(booking, "start", "timeZone", value);
      break;
    default: {
      const key: StringField = field;
      booking = { ...booking };
      if (value || key === "title") booking[key] = value;
      else delete booking[key];
    }
  }

  const warnings = booking.warnings.filter((w) => w !== `missing:${field}` && w !== `invalid:${field}` && w !== "end_before_start");
  if (endsBeforeStart(booking.start, booking.end)) warnings.push("end_before_start");
  booking = withConfirmed({ ...booking, warnings }, [field]);
  return { ok: true, item: { ...item, booking } };
}

/** Marks every doubtful field as reviewed by the user. Missing required data stays pending. */
export function confirmBookingReviewed(item: ReviewItem): ReviewItem {
  const doubtful = (Object.entries(item.booking.fieldStatus) as [BookingField, string][])
    .filter(([, status]) => status === "needs_confirmation")
    .map(([field]) => field);
  return { ...item, booking: withConfirmed(item.booking, doubtful) };
}

/** Fields the user still has to review or fill in before this booking can be confirmed. */
export function pendingDoubts(item: ReviewItem): BookingField[] {
  const { booking } = item;
  const confirmed = new Set(booking.userConfirmedFields ?? []);
  const pending = (Object.entries(booking.fieldStatus) as [BookingField, string][])
    .filter(([field, status]) => status === "needs_confirmation" && !confirmed.has(field))
    .map(([field]) => field);
  const add = (field: BookingField) => {
    if (!pending.includes(field)) pending.push(field);
  };
  if (!booking.title.trim()) add("title");
  if (!booking.start?.date) add("startDate");
  if (booking.warnings.includes("end_before_start")) add("endDate");
  return pending;
}

/** Why the included items cannot be confirmed yet (empty when they can). */
export function confirmBlockers(items: ReviewItem[], days: TripDay[]): ConfirmBlocker[] {
  const blockers: ConfirmBlocker[] = [];
  for (const item of items) {
    if (!item.included) continue;
    if (pendingDoubts(item).length > 0) {
      blockers.push({ itemId: item.id, reason: "doubts" });
      continue;
    }
    if (bookingToActivities(item.booking, days, "en").activities.length === 0) {
      blockers.push({ itemId: item.id, reason: "outside_trip" });
    }
  }
  return blockers;
}

export function canConfirm(items: ReviewItem[], days: TripDay[]): boolean {
  return items.some((i) => i.included) && confirmBlockers(items, days).length === 0;
}

/** Activities for every included booking, plus the first activity of each file (its PDF is uploaded there, once). */
export function buildBookingActivities(
  items: ReviewItem[],
  days: TripDay[],
  lang: Lang,
): { activities: NewActivity[]; uploads: { fileId: string; activityIndex: number }[] } {
  const activities: NewActivity[] = [];
  const uploads: { fileId: string; activityIndex: number }[] = [];
  for (const item of items) {
    if (!item.included) continue;
    const created = bookingToActivities(item.booking, days, lang).activities;
    if (created.length && !uploads.some((u) => u.fileId === item.fileId)) {
      uploads.push({ fileId: item.fileId, activityIndex: activities.length });
    }
    activities.push(...created);
  }
  return { activities, uploads };
}

/** Accepted proposals become suggested activities; proposals without a trip day are dropped. */
export function proposalsToActivities(accepted: Proposal[], days: TripDay[]): NewActivity[] {
  const activities: NewActivity[] = [];
  for (const proposal of accepted) {
    const day = days.find((d) => d.date === proposal.date);
    if (!day) continue;
    const category = CATEGORIES.includes(proposal.category as ActivityCategory) ? proposal.category as ActivityCategory : "other";
    activities.push({
      dayId: day.id,
      city: day.city,
      title: proposal.title,
      time: proposal.time,
      durationMin: proposal.durationMin,
      ...(proposal.notes ? { notes: proposal.notes } : {}),
      ...(proposal.location ? { location: proposal.location } : {}),
      category,
      priority: "medium",
      state: "pending",
      sort_order: 0,
      timeInferred: true,
      origin: "suggested",
    });
  }
  return activities;
}
