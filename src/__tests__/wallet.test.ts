import { describe, expect, it } from "vitest";
import {
  groupBookingsByType,
  groupDocumentsByDay,
  selectTodayBookings,
  selectTripBookings,
  selectTripDocuments,
} from "@/lib/wallet";
import type { Activity, ActivityFile, BookingDetails, TripDay, TripPlan } from "@/lib/types";

function file(id: string, activityId: string, fileName = `${id}.pdf`): ActivityFile {
  return {
    id,
    activityId,
    tripId: "t",
    userId: "u",
    fileUrl: `https://files/${id}`,
    filePath: id,
    fileType: "pdf",
    fileName,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function booking(groupId: string, overrides: Partial<BookingDetails> = {}): BookingDetails {
  return { version: 1, type: "flight", role: "single", groupId, title: `Booking ${groupId}`, fieldStatus: {}, ...overrides };
}

function activity(id: string, dayId: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    dayId,
    tripId: "t",
    userId: "u",
    city: "Tokyo",
    title: `Activity ${id}`,
    time: "10:00",
    durationMin: 60,
    category: "sightseeing",
    priority: "medium",
    state: "pending",
    sort_order: 0,
    ...overrides,
  };
}

function day(id: string, date: string, activities: Activity[]): TripDay {
  return { id, date, city: "Tokyo", label: id, activities, userId: "u" };
}

function trip(days: TripDay[]): TripPlan {
  return { id: "t", name: "Trip", days, criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [] };
}

const hotel = booking("stay", {
  type: "lodging",
  title: "Hotel Gion",
  provider: "Booking.com",
  reference: "ABC123",
  start: { date: "2026-10-26", time: "15:00" },
  end: { date: "2026-10-28", time: "11:00" },
  address: "Gion 1",
});

const tripWithStay = trip([
  day("d1", "2026-10-26", [
    activity("in", "d1", { origin: "booking", time: "15:00", booking: { ...hotel, role: "check_in" }, files: [file("f1", "in")] }),
    activity("visit", "d1", { time: "09:00", files: [file("f2", "visit", "map.png")] }),
  ]),
  day("d2", "2026-10-27", [activity("free", "d2")]),
  day("d3", "2026-10-28", [
    activity("out", "d3", { origin: "booking", time: "11:00", booking: { ...hotel, role: "check_out" }, files: [file("f1", "out"), file("f3", "out")] }),
  ]),
]);

describe("selectTripBookings", () => {
  it("groups the activities of one booking into one entry", () => {
    const bookings = selectTripBookings(tripWithStay);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      groupId: "stay",
      type: "lodging",
      title: "Hotel Gion",
      provider: "Booking.com",
      reference: "ABC123",
      address: "Gion 1",
      start: { date: "2026-10-26", time: "15:00" },
      end: { date: "2026-10-28", time: "11:00" },
      activityIds: ["in", "out"],
      dayIds: ["d1", "d3"],
      dayDates: ["2026-10-26", "2026-10-28"],
    });
  });

  it("attaches the documents of all its activities once each", () => {
    const [stay] = selectTripBookings(tripWithStay);
    expect(stay.documents.map((f) => f.id)).toEqual(["f1", "f3"]);
  });

  it("ignores activities that are not bookings", () => {
    const bookings = selectTripBookings(tripWithStay);
    expect(bookings.flatMap((b) => b.activityIds)).not.toContain("visit");
  });

  it("sorts by start date and time with undated bookings last", () => {
    const plan = trip([
      day("d1", "2026-10-26", [
        activity("undated", "d1", { origin: "booking", booking: booking("u", { title: "Undated" }) }),
        activity("late", "d1", { origin: "booking", booking: booking("l", { start: { date: "2026-10-26", time: "18:00" } }) }),
        activity("early", "d1", { origin: "booking", booking: booking("e", { start: { date: "2026-10-26", time: "07:30" } }) }),
        activity("dateOnly", "d1", { origin: "booking", booking: booking("o", { start: { date: "2026-10-25" } }) }),
      ]),
    ]);
    expect(selectTripBookings(plan).map((b) => b.groupId)).toEqual(["o", "e", "l", "u"]);
  });

  it("takes the earliest start and latest end across the booking's activities", () => {
    const plan = trip([
      day("d1", "2026-10-26", [
        activity("pick", "d1", { origin: "booking", booking: booking("car", { type: "car_rental", role: "pickup", start: { date: "2026-10-26", time: "09:00" } }) }),
      ]),
      day("d2", "2026-10-29", [
        activity("drop", "d2", { origin: "booking", booking: booking("car", { type: "car_rental", role: "dropoff", end: { date: "2026-10-29", time: "20:00" } }) }),
      ]),
    ]);
    const [car] = selectTripBookings(plan);
    expect(car.start).toEqual({ date: "2026-10-26", time: "09:00" });
    expect(car.end).toEqual({ date: "2026-10-29", time: "20:00" });
  });
});

describe("selectTodayBookings", () => {
  it("picks bookings with an activity on today or starting or ending today", () => {
    const bookings = selectTripBookings(tripWithStay);
    expect(selectTodayBookings(bookings, "2026-10-28").map((b) => b.groupId)).toEqual(["stay"]);
    expect(selectTodayBookings(bookings, "2026-10-26").map((b) => b.groupId)).toEqual(["stay"]);
    expect(selectTodayBookings(bookings, "2026-10-27")).toEqual([]);
  });
});

describe("groupBookingsByType", () => {
  it("orders flights, lodging, transport, tickets and other, skipping empty groups", () => {
    const plan = trip([
      day("d1", "2026-10-26", [
        activity("a", "d1", { origin: "booking", booking: booking("tk", { type: "ticket" }) }),
        activity("b", "d1", { origin: "booking", booking: booking("tr", { type: "train" }) }),
        activity("c", "d1", { origin: "booking", booking: booking("fl", { type: "flight" }) }),
      ]),
    ]);
    const groups = groupBookingsByType(selectTripBookings(plan));
    expect(groups.map((g) => g.kind)).toEqual(["flights", "transport", "tickets"]);
    expect(groups[1].bookings.map((b) => b.groupId)).toEqual(["tr"]);
  });
});

describe("selectTripDocuments", () => {
  it("lists every file once, ordered by day and activity time, labeled with its activity", () => {
    const docs = selectTripDocuments(tripWithStay);
    expect(docs.map((d) => d.file.id)).toEqual(["f2", "f1", "f3"]);
    expect(docs[0]).toMatchObject({ activityId: "visit", activityTitle: "Activity visit", dayId: "d1", dayDate: "2026-10-26" });
    expect(docs[0].bookingType).toBeUndefined();
    expect(docs[1]).toMatchObject({ activityId: "in", bookingType: "lodging" });
    expect(docs[2]).toMatchObject({ activityId: "out", dayId: "d3" });
  });

  it("groups documents by day in trip order", () => {
    const groups = groupDocumentsByDay(selectTripDocuments(tripWithStay));
    expect(groups.map((g) => [g.dayId, g.documents.length])).toEqual([
      ["d1", 2],
      ["d3", 1],
    ]);
  });

  it("is empty for a trip without files", () => {
    expect(selectTripDocuments(trip([day("d1", "2026-10-26", [activity("a", "d1")])]))).toEqual([]);
  });
});
