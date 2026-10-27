import { describe, expect, it } from "vitest";
import { findBookingDuplicates } from "@/lib/bookings/dedupe";
import type { ExtractedBooking } from "@/lib/bookings/extract";
import type { Activity, BookingDetails } from "@/lib/types";
import { FAKE_SHA, OTHER_SHA } from "./fixtures/bookings/documents";

function candidate(id: string, patch: Partial<ExtractedBooking> = {}): ExtractedBooking {
  return {
    id,
    type: "flight",
    title: "Flight",
    fieldStatus: {},
    warnings: [],
    source: { fileName: "same-name.pdf", sha256: OTHER_SHA },
    ...patch,
  };
}

function existing(id: string, booking: Partial<BookingDetails>): Activity {
  return {
    id,
    dayId: "d1",
    tripId: "t1",
    userId: "u1",
    city: "La Palma",
    title: "Existing",
    time: "10:00",
    durationMin: 60,
    category: "transport",
    priority: "critical",
    state: "pending",
    sort_order: 0,
    origin: "booking",
    booking: { version: 1, type: "flight", role: "departure", groupId: "g", title: "x", fieldStatus: {}, ...booking },
  };
}

describe("findBookingDuplicates", () => {
  it("matches an existing booking by normalized reference and type", () => {
    const result = findBookingDuplicates(
      [candidate("c1", { reference: " zz9 tst " }), candidate("c2", { type: "lodging", reference: "ZZ9TST" })],
      [existing("a1", { reference: "ZZ9TST" })],
    );
    expect(result).toEqual({ c1: { kind: "existing", matchId: "a1", reason: "reference" } });
  });

  it("matches an existing booking imported from the same file hash", () => {
    const result = findBookingDuplicates(
      [candidate("c1", { reference: "NEW1", source: { fileName: "renamed.pdf", sha256: FAKE_SHA } })],
      [existing("a1", { reference: "OLD", source: { fileName: "original.pdf", sha256: FAKE_SHA } })],
    );
    expect(result).toEqual({ c1: { kind: "existing", matchId: "a1", reason: "same_file" } });
  });

  it("matches same type, provider, start date and time when there is no reference", () => {
    const start = { date: "2026-06-10", time: "10:00" };
    const result = findBookingDuplicates(
      [candidate("c1", { provider: "fakeair", start }), candidate("c2", { provider: "FakeAir", start: { ...start, time: "11:00" } })],
      [existing("a1", { provider: "FakeAir", start })],
    );
    expect(result).toEqual({ c1: { kind: "existing", matchId: "a1", reason: "same_details" } });
  });

  it("does not match by details when both sides have different references", () => {
    const start = { date: "2026-06-10", time: "10:00" };
    expect(findBookingDuplicates(
      [candidate("c1", { provider: "FakeAir", start, reference: "A1" })],
      [existing("a1", { provider: "FakeAir", start, reference: "B2" })],
    )).toEqual({});
  });

  it("points later batch occurrences to the first one", () => {
    const result = findBookingDuplicates(
      [candidate("c1", { reference: "R1" }), candidate("c2", { reference: "r 1" }), candidate("c3", { reference: "R2" })],
      [],
    );
    expect(result).toEqual({ c2: { kind: "batch", matchId: "c1", reason: "reference" } });
  });

  it("does not consider bookings from one file duplicates of each other", () => {
    const sameSource = { fileName: "f.pdf", sha256: FAKE_SHA };
    expect(findBookingDuplicates(
      [candidate("c1", { reference: "A", source: sameSource }), candidate("c2", { reference: "B", source: sameSource })],
      [],
    )).toEqual({});
  });

  it("never matches by file name alone", () => {
    const result = findBookingDuplicates(
      [candidate("c1", { reference: "NEW", source: { fileName: "booking.pdf", sha256: OTHER_SHA } })],
      [existing("a1", { reference: "OLD", source: { fileName: "booking.pdf", sha256: FAKE_SHA } })],
    );
    expect(result).toEqual({});
  });

  it("ignores activities without booking details", () => {
    const manual: Activity = { ...existing("a1", {}), booking: undefined, origin: "manual" };
    expect(findBookingDuplicates([candidate("c1", { reference: "R" })], [manual])).toEqual({});
  });
});
