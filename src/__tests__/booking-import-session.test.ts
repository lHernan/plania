import { describe, expect, it } from "vitest";
import type { Activity, TripDay } from "@/lib/types";
import type { ExtractedBooking } from "@/lib/bookings/extract";
import {
  buildBookingActivities,
  canConfirm,
  confirmBlockers,
  confirmBookingReviewed,
  createReviewItems,
  editBookingField,
  pendingDoubts,
  proposalsToActivities,
  type ReviewItem,
} from "@/lib/bookings/import-session";

// FAKE La Palma-like trip data.
const days: TripDay[] = [
  { id: "d1", date: "2031-05-10", city: "Santa Cruz de La Palma", label: "Day 1", activities: [], userId: "u" },
  { id: "d2", date: "2031-05-11", city: "Los Llanos de Aridane", label: "Day 2", activities: [], userId: "u" },
  { id: "d3", date: "2031-05-12", city: "Los Llanos de Aridane", label: "Day 3", activities: [], userId: "u" },
];

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function flight(overrides: Partial<ExtractedBooking> = {}): ExtractedBooking {
  return {
    id: "aaaaaaaa-0",
    type: "flight",
    title: "MAD → SPC",
    provider: "Fake Air",
    reference: "FAKE01",
    start: { date: "2031-05-10", time: "08:00", timeZone: "Europe/Madrid" },
    end: { date: "2031-05-10", time: "09:45", timeZone: "Atlantic/Canary" },
    from: "MAD",
    to: "SPC",
    fieldStatus: { title: "extracted", startDate: "extracted", startTime: "extracted", reference: "extracted", timeZone: "estimated" },
    source: { fileName: "flight.pdf", sha256: SHA_A },
    warnings: [],
    ...overrides,
  };
}

function car(overrides: Partial<ExtractedBooking> = {}): ExtractedBooking {
  return {
    id: "bbbbbbbb-0",
    type: "car_rental",
    title: "Fake Cars SPC",
    provider: "Fake Cars",
    reference: "CAR42",
    start: { date: "2031-05-10", time: "10:30" },
    end: { date: "2031-05-12", time: "18:00" },
    pickupLocation: "SPC airport",
    fieldStatus: { title: "extracted", startDate: "extracted", startTime: "extracted" },
    source: { fileName: "car.pdf", sha256: SHA_B },
    warnings: [],
    ...overrides,
  };
}

const results = (...files: { fileId: string; bookings: ExtractedBooking[] }[]) => files;

describe("createReviewItems", () => {
  it("excludes duplicates of saved bookings by default and keeps the reason", () => {
    const existing = [{
      id: "saved-1",
      origin: "booking",
      booking: { version: 1, type: "flight", role: "departure", groupId: "g", title: "x", reference: "fake01", fieldStatus: {} },
    }] as unknown as Activity[];
    const items = createReviewItems(results({ fileId: "f1", bookings: [flight()] }, { fileId: "f2", bookings: [car()] }), existing);
    expect(items.map((i) => [i.fileId, i.included, i.duplicate?.reason])).toEqual([
      ["f1", false, "reference"],
      ["f2", true, undefined],
    ]);
  });

  it("flags a booking repeated in the same import as a batch duplicate", () => {
    const items = createReviewItems(
      results({ fileId: "f1", bookings: [flight()] }, { fileId: "f2", bookings: [flight({ id: "cccccccc-0", source: { fileName: "copy.pdf", sha256: "c".repeat(64) } })] }),
      [],
    );
    expect(items[1]).toMatchObject({ included: false, duplicate: { kind: "batch", reason: "reference" } });
  });
});

describe("doubts and editing", () => {
  it("blocks confirmation while a field needs confirmation, until the user reviews it", () => {
    const [item] = createReviewItems(results({ fileId: "f1", bookings: [flight({ fieldStatus: { title: "extracted", startDate: "extracted", startTime: "needs_confirmation" } })] }), []);
    expect(pendingDoubts(item)).toEqual(["startTime"]);
    expect(canConfirm([item], days)).toBe(false);
    expect(confirmBlockers([item], days)).toEqual([{ itemId: item.id, reason: "doubts" }]);

    const reviewed = confirmBookingReviewed(item);
    expect(pendingDoubts(reviewed)).toEqual([]);
    expect(reviewed.booking.userConfirmedFields).toEqual(["startTime"]);
    // The AI's own label is never rewritten.
    expect(reviewed.booking.fieldStatus.startTime).toBe("needs_confirmation");
    expect(canConfirm([reviewed], days)).toBe(true);
  });

  it("requires a title and a start date even after review", () => {
    const [item] = createReviewItems(results({ fileId: "f1", bookings: [flight({ title: "", start: undefined, warnings: ["missing:title", "missing:startDate"] })] }), []);
    const reviewed = confirmBookingReviewed(item);
    expect(pendingDoubts(reviewed)).toEqual(expect.arrayContaining(["title", "startDate"]));
    expect(canConfirm([reviewed], days)).toBe(false);
  });

  it("an edit resolves the doubt, records the field and clears its warning", () => {
    const [item] = createReviewItems(results({ fileId: "f1", bookings: [flight({ start: undefined, warnings: ["missing:startDate"], fieldStatus: { title: "extracted" } })] }), []);
    const result = editBookingField(item, "startDate", "2031-05-10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.booking.start?.date).toBe("2031-05-10");
    expect(result.item.booking.userConfirmedFields).toContain("startDate");
    expect(result.item.booking.warnings).not.toContain("missing:startDate");
    expect(pendingDoubts(result.item)).not.toContain("startDate");
  });

  it.each([
    ["startDate", "10/05/2031", "invalid_date"],
    ["endDate", "2031-02-30", "invalid_date"],
    ["startTime", "8:00", "invalid_time"],
    ["endTime", "25:00", "invalid_time"],
    ["timeZone", "Mars/Olympus", "invalid_time_zone"],
    ["title", "   ", "required"],
    ["startDate", "", "required"],
  ] as const)("rejects %s = %j", (field, value, error) => {
    const [item] = createReviewItems(results({ fileId: "f1", bookings: [flight()] }), []);
    expect(editBookingField(item, field, value)).toEqual({ ok: false, error });
  });

  it("flags an end before the start as a doubt", () => {
    const [item] = createReviewItems(results({ fileId: "f1", bookings: [car()] }), []);
    const result = editBookingField(item, "endDate", "2031-05-09");
    if (!result.ok) throw new Error("expected ok");
    expect(result.item.booking.warnings).toContain("end_before_start");
    expect(pendingDoubts(result.item)).toContain("endDate");
  });
});

describe("trip dates", () => {
  it("a booking outside the trip dates cannot be confirmed", () => {
    const [item] = createReviewItems(results({ fileId: "f1", bookings: [flight({ start: { date: "2031-06-01", time: "08:00" }, end: undefined })] }), []);
    expect(confirmBlockers([item], days)).toEqual([{ itemId: item.id, reason: "outside_trip" }]);
    expect(canConfirm([item], days)).toBe(false);
  });

  it("excluded items never block, but something must be included", () => {
    const items = createReviewItems(results({ fileId: "f1", bookings: [flight({ start: { date: "2031-06-01" } })] }, { fileId: "f2", bookings: [car()] }), []);
    const toggled: ReviewItem[] = [{ ...items[0], included: false }, items[1]];
    expect(canConfirm(toggled, days)).toBe(true);
    expect(canConfirm(toggled.map((i) => ({ ...i, included: false })), days)).toBe(false);
  });
});

describe("buildBookingActivities", () => {
  it("creates booking activities on their days and uploads each file once", () => {
    const items = createReviewItems(
      results(
        { fileId: "f1", bookings: [flight(), flight({ id: "aaaaaaaa-1", reference: "FAKE02", title: "SPC → MAD", start: { date: "2031-05-12", time: "19:00" }, end: { date: "2031-05-12", time: "22:40" } })] },
        { fileId: "f2", bookings: [car()] },
      ),
      [],
    );
    const { activities, uploads } = buildBookingActivities(items, days, "es");
    expect(activities.map((a) => [a.dayId, a.origin, a.booking?.role, a.time])).toEqual([
      ["d1", "booking", "departure", "08:00"],
      ["d3", "booking", "departure", "19:00"],
      ["d1", "booking", "pickup", "10:30"],
      ["d3", "booking", "dropoff", "18:00"],
    ]);
    expect(uploads).toEqual([{ fileId: "f1", activityIndex: 0 }, { fileId: "f2", activityIndex: 2 }]);
  });

  it("skips excluded items", () => {
    const items = createReviewItems(results({ fileId: "f1", bookings: [flight()] }, { fileId: "f2", bookings: [car()] }), []);
    const { activities, uploads } = buildBookingActivities([{ ...items[0], included: false }, items[1]], days, "en");
    expect(activities.every((a) => a.booking?.type === "car_rental")).toBe(true);
    expect(uploads).toEqual([{ fileId: "f2", activityIndex: 0 }]);
  });
});

describe("proposalsToActivities", () => {
  it("turns accepted proposals into suggested activities on the right days", () => {
    const activities = proposalsToActivities([
      { title: "Roque de los Muchachos viewpoint", category: "sightseeing", date: "2031-05-11", time: "10:00", durationMin: 120, notes: "Check road status" },
      { title: "Puerto de Tazacorte", category: "weird", location: "Tazacorte", date: "2031-05-12", time: "11:00", durationMin: 90 },
      { title: "Nowhere", category: "food", date: "2031-07-01", time: "11:00", durationMin: 60 },
    ], days);
    expect(activities).toEqual([
      expect.objectContaining({ dayId: "d2", city: "Los Llanos de Aridane", origin: "suggested", priority: "medium", state: "pending", timeInferred: true, category: "sightseeing", notes: "Check road status" }),
      expect.objectContaining({ dayId: "d3", category: "other", location: "Tazacorte", origin: "suggested" }),
    ]);
  });
});
