import { describe, expect, it } from "vitest";
import { bookingToActivities } from "@/lib/bookings/to-activities";
import { normalizeExtractedBookings } from "@/lib/bookings/extract";
import type { TripDay } from "@/lib/types";
import { FAKE_SHA } from "./fixtures/bookings/documents";
import { CAR_RESPONSE, FLIGHT_RESPONSE, LODGING_RESPONSE, MISSING_TIMES_RESPONSE } from "./fixtures/bookings/model-responses";

const source = { fileName: "fake.pdf", sha256: FAKE_SHA };
const days: TripDay[] = ["2026-06-10", "2026-06-14", "2026-06-17"].map((date, i) => ({
  id: `day-${i}`,
  date,
  city: "La Palma",
  label: `Day ${i + 1}`,
  activities: [],
  userId: "u1",
}));

describe("bookingToActivities", () => {
  it("creates one departure for a flight with the time-zone aware duration", () => {
    const [outbound] = normalizeExtractedBookings(FLIGHT_RESPONSE, source);
    const { activities, problems } = bookingToActivities(outbound, days, "en");
    expect(problems).toEqual([]);
    expect(activities).toHaveLength(1);
    const [a] = activities;
    expect(a).toMatchObject({
      dayId: "day-0",
      city: "La Palma",
      title: "Flight MAD → SPC",
      time: "10:00",
      durationMin: 175,
      location: "Madrid (MAD)",
      category: "transport",
      priority: "critical",
      state: "pending",
      sort_order: 0,
      origin: "booking",
      timeInferred: false,
    });
    expect(a.notes).toContain("ZZ9TST");
    expect(a.notes).toContain("FakeAir");
    expect(a.notes).toContain("Madrid (MAD) → La Palma (SPC)");
    expect(a.booking).toMatchObject({ version: 1, type: "flight", role: "departure", groupId: outbound.id, reference: "ZZ9TST", source });
    expect(a.booking).not.toHaveProperty("id");
    expect(a.booking).not.toHaveProperty("warnings");
  });

  it("estimates a flight duration of 120 minutes when the arrival is unknown", () => {
    const [b] = normalizeExtractedBookings({ bookings: [{ ...FLIGHT_RESPONSE.bookings[0], endTime: null }] }, source);
    const [a] = bookingToActivities(b, days, "en").activities;
    expect(a.durationMin).toBe(120);
    expect(a.booking?.fieldStatus.endTime).toBe("estimated");
  });

  it("creates check-in and check-out for lodging", () => {
    const [stay] = normalizeExtractedBookings(LODGING_RESPONSE, source);
    const { activities, problems } = bookingToActivities(stay, days, "es");
    expect(problems).toEqual([]);
    expect(activities.map((a) => [a.booking?.role, a.dayId, a.time, a.category, a.location])).toEqual([
      ["check_in", "day-0", "16:00", "hotel", "Calle Inventada 1, Los Llanos de Aridane"],
      ["check_out", "day-2", "10:00", "hotel", "Calle Inventada 1, Los Llanos de Aridane"],
    ]);
    expect(activities[0].title).toBe("Check-in: Cozy house in Los Llanos");
    expect(activities[1].title).toBe("Check-out: Cozy house in Los Llanos");
    expect(new Set(activities.map((a) => a.booking?.groupId))).toEqual(new Set([stay.id]));
  });

  it("creates pickup and dropoff for a car rental", () => {
    const [car] = normalizeExtractedBookings(CAR_RESPONSE, source);
    const { activities } = bookingToActivities(car, days, "es");
    expect(activities.map((a) => [a.booking?.role, a.dayId, a.time, a.category, a.location, a.title])).toEqual([
      ["pickup", "day-0", "12:30", "transport", "La Palma Airport (SPC)", "Recogida: FakeCars rental"],
      ["dropoff", "day-2", "16:30", "transport", "La Palma Airport (SPC)", "Devolución: FakeCars rental"],
    ]);
  });

  it("infers a default time and marks it estimated when the time is missing", () => {
    const [ferry] = normalizeExtractedBookings(MISSING_TIMES_RESPONSE, source);
    const [a] = bookingToActivities(ferry, days, "en").activities;
    expect(a).toMatchObject({ time: "09:00", timeInferred: true, category: "transport", dayId: "day-1" });
    expect(a.booking?.role).toBe("single");
    expect(a.booking?.fieldStatus.startTime).toBe("estimated");
  });

  it("uses a type word when the title is missing", () => {
    const [b] = normalizeExtractedBookings({ bookings: [{ type: "train", startDate: "2026-06-14" }] }, source);
    expect(bookingToActivities(b, days, "es").activities[0].title).toBe("Tren");
    expect(bookingToActivities(b, days, "en").activities[0].title).toBe("Train");
  });

  it("maps categories for tickets and other bookings", () => {
    const [ticket, other] = normalizeExtractedBookings({
      bookings: [
        { type: "ticket", title: "Museum", startDate: "2026-06-14" },
        { type: "other", title: "Dinner", startDate: "2026-06-14" },
      ],
    }, source);
    expect(bookingToActivities(ticket, days, "en").activities[0].category).toBe("reservation");
    expect(bookingToActivities(other, days, "en").activities[0].category).toBe("other");
  });

  it("reports missing start dates and dates outside the trip", () => {
    const [noDate] = normalizeExtractedBookings({ bookings: [{ type: "ticket", title: "T" }] }, source);
    expect(bookingToActivities(noDate, days, "en")).toEqual({ activities: [], problems: ["missing_start_date"] });

    const [stay] = normalizeExtractedBookings({
      bookings: [{ ...LODGING_RESPONSE.bookings[0], endDate: { value: "2026-06-20", status: "extracted" } }],
    }, source);
    const result = bookingToActivities(stay, days, "en");
    expect(result.activities.map((a) => a.booking?.role)).toEqual(["check_in"]);
    expect(result.problems).toEqual(["outside_trip_dates"]);
  });
});
