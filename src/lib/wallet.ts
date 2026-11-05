import { isTripUndated } from "@/lib/trip-undated";
import type { ActivityFile, BookingMoment, BookingType, TripPlan } from "@/lib/types";

/** One confirmed booking of the trip, gathered from the activities that share its groupId. */
export type WalletBooking = {
  groupId: string;
  type: BookingType;
  title: string;
  provider?: string;
  reference?: string;
  /** Earliest start and latest end across its activities. */
  start?: BookingMoment;
  end?: BookingMoment;
  from?: string;
  to?: string;
  address?: string;
  /** In trip order; the first one is where "show in itinerary" goes. */
  activityIds: string[];
  dayIds: string[];
  dayDates: string[];
  /** Files attached to any of its activities, once each. */
  documents: ActivityFile[];
};

/** A file of the trip with the activity and day it belongs to. */
export type WalletDocument = {
  file: ActivityFile;
  activityId: string;
  activityTitle: string;
  activityTime: string;
  dayId: string;
  dayDate: string;
  /** Set when the activity is a booking. */
  bookingType?: BookingType;
};

export type BookingGroupKind = "flights" | "lodging" | "transport" | "tickets" | "other";

const GROUP_ORDER: BookingGroupKind[] = ["flights", "lodging", "transport", "tickets", "other"];

const GROUP_OF_TYPE: Record<BookingType, BookingGroupKind> = {
  flight: "flights",
  lodging: "lodging",
  car_rental: "transport",
  train: "transport",
  ferry: "transport",
  bus: "transport",
  transfer: "transport",
  ticket: "tickets",
  other: "other",
};

/** Sortable key; a moment without a time sorts as the start of its day. */
function momentKey(moment?: BookingMoment): string | null {
  if (!moment?.date) return null;
  return `${moment.date}T${moment.time ?? "00:00"}`;
}

function earlier(a: BookingMoment | undefined, b: BookingMoment | undefined): BookingMoment | undefined {
  const ka = momentKey(a);
  const kb = momentKey(b);
  if (!kb) return ka ? a : undefined;
  if (!ka) return b;
  return kb < ka ? b : a;
}

function later(a: BookingMoment | undefined, b: BookingMoment | undefined): BookingMoment | undefined {
  const ka = momentKey(a);
  const kb = momentKey(b);
  if (!kb) return ka ? a : undefined;
  if (!ka) return b;
  return kb > ka ? b : a;
}

export function selectTripBookings(trip: TripPlan): WalletBooking[] {
  const byGroup = new Map<string, WalletBooking>();

  for (const day of trip.days) {
    for (const activity of day.activities) {
      const details = activity.booking;
      if (activity.origin !== "booking" || !details) continue;

      let entry = byGroup.get(details.groupId);
      if (!entry) {
        entry = {
          groupId: details.groupId,
          type: details.type,
          title: details.title || activity.title,
          provider: details.provider,
          reference: details.reference,
          from: details.from,
          to: details.to,
          address: details.address,
          activityIds: [],
          dayIds: [],
          dayDates: [],
          documents: [],
        };
        byGroup.set(details.groupId, entry);
      }

      entry.provider ??= details.provider;
      entry.reference ??= details.reference;
      entry.from ??= details.from;
      entry.to ??= details.to;
      entry.address ??= details.address;
      entry.start = earlier(entry.start, details.start);
      entry.end = later(entry.end, details.end);
      entry.activityIds.push(activity.id);
      if (!entry.dayIds.includes(day.id)) {
        entry.dayIds.push(day.id);
        entry.dayDates.push(day.date);
      }
      for (const file of activity.files ?? []) {
        if (!entry.documents.some((f) => f.id === file.id)) entry.documents.push(file);
      }
    }
  }

  // Undated bookings go last; the rest by start, keeping trip order on ties.
  return [...byGroup.values()]
    .map((booking, index) => ({ booking, index, key: momentKey(booking.start) }))
    .sort((a, b) => {
      if (a.key && b.key && a.key !== b.key) return a.key < b.key ? -1 : 1;
      if (a.key && !b.key) return -1;
      if (!a.key && b.key) return 1;
      return a.index - b.index;
    })
    .map(({ booking }) => booking);
}

/** Bookings with an activity on `today`, or that start or end that day. */
export function selectTodayBookings(bookings: WalletBooking[], today: string): WalletBooking[] {
  return bookings.filter(
    (b) => b.dayDates.includes(today) || b.start?.date === today || b.end?.date === today
  );
}

/** Flights, lodging, transport, tickets and other, in that order; empty groups are left out. */
export function groupBookingsByType(bookings: WalletBooking[]): { kind: BookingGroupKind; bookings: WalletBooking[] }[] {
  return GROUP_ORDER.map((kind) => ({ kind, bookings: bookings.filter((b) => GROUP_OF_TYPE[b.type] === kind) })).filter(
    (group) => group.bookings.length > 0
  );
}

export function selectTripDocuments(trip: TripPlan): WalletDocument[] {
  const seen = new Set<string>();
  const documents: (WalletDocument & { order: number })[] = [];
  // An undated trip's day dates are placeholders: its documents go by day order, without a date.
  const undated = isTripUndated(trip);

  trip.days.forEach((day, dayIndex) => {
    for (const activity of day.activities) {
      for (const file of activity.files ?? []) {
        if (seen.has(file.id)) continue;
        seen.add(file.id);
        documents.push({
          file,
          activityId: activity.id,
          activityTitle: activity.title,
          activityTime: activity.time,
          dayId: day.id,
          dayDate: undated ? "" : day.date,
          bookingType: activity.origin === "booking" ? activity.booking?.type : undefined,
          order: dayIndex,
        });
      }
    }
  });

  // Day date then activity time; trip order breaks ties (and orders days without a date).
  return documents
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      if (a.doc.dayDate !== b.doc.dayDate) return a.doc.dayDate < b.doc.dayDate ? -1 : 1;
      if (a.doc.order !== b.doc.order) return a.doc.order - b.doc.order;
      if (a.doc.activityTime !== b.doc.activityTime) return a.doc.activityTime < b.doc.activityTime ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ doc: { order: _order, ...doc } }) => doc);
}

/** Consecutive documents of the same day, in the order given. */
export function groupDocumentsByDay(documents: WalletDocument[]): { dayId: string; dayDate: string; documents: WalletDocument[] }[] {
  const groups: { dayId: string; dayDate: string; documents: WalletDocument[] }[] = [];
  for (const doc of documents) {
    const last = groups[groups.length - 1];
    if (last && last.dayId === doc.dayId) last.documents.push(doc);
    else groups.push({ dayId: doc.dayId, dayDate: doc.dayDate, documents: [doc] });
  }
  return groups;
}
