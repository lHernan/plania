import { describe, expect, it } from "vitest";
import { isFixedTime, timeForMove } from "@/lib/schedule/fit";
import type { Activity, BookingDetails } from "@/lib/types";

const DATE = "2026-11-02";

const activity = (id: string, time: string, extra: Partial<Activity> = {}): Activity => ({
  id, dayId: "d2", tripId: "t", userId: "u", city: "La Palma", title: id, time, durationMin: 60,
  category: "sightseeing", priority: "medium", state: "pending", sort_order: 0, ...extra,
});

const booking = (type: BookingDetails["type"], role: BookingDetails["role"], extra: Partial<BookingDetails> = {}): Partial<Activity> => ({
  origin: "booking",
  booking: { version: 1, type, role, groupId: "g", title: type, fieldStatus: {}, ...extra },
});

const flight = activity("flight", "10:00", { durationMin: 40, ...booking("flight", "single", { start: { date: DATE, time: "10:00" }, end: { date: DATE, time: "10:40" } }) });
const checkout = activity("checkout", "10:30", { durationMin: 0, category: "hotel", ...booking("lodging", "check_out", { end: { date: DATE, time: "10:30" } }) });

describe("timeForMove", () => {
  it("moves a check-out dragged above a flight to before the airport margin", () => {
    // Flight at 10:00 → at the airport by 08:00 → leave the flat 15 min earlier.
    expect(timeForMove([flight, checkout], "checkout", "flight", DATE)).toEqual({ kind: "moved", time: "07:45" });
  });

  it("never moves a booking: flights, tickets and car pickups keep their time", () => {
    const ticket = activity("sagrada", "11:00", booking("ticket", "single"));
    const car = activity("car", "09:00", booking("car_rental", "pickup"));
    const walk = activity("walk", "08:00");
    expect(timeForMove([walk, ticket], "sagrada", "walk", DATE)).toEqual({ kind: "fixed" });
    expect(timeForMove([walk, car], "car", "walk", DATE)).toEqual({ kind: "fixed" });
    expect(timeForMove([checkout, flight], "flight", "checkout", DATE)).toEqual({ kind: "fixed" });
  });

  it("treats a hand-made reservation as fixed too", () => {
    const entry = activity("entry", "11:00", { category: "reservation" });
    expect(isFixedTime(entry)).toBe(true);
    expect(timeForMove([activity("walk", "08:00"), entry], "entry", "walk", DATE)).toEqual({ kind: "fixed" });
  });

  it("fits a plain activity dragged above a ticket so it ends before the entry", () => {
    const ticket = activity("sagrada", "11:00", booking("ticket", "single"));
    const lunch = activity("lunch", "13:00", { durationMin: 60 });
    // 60 min + 15 min walk must end by 11:00.
    expect(timeForMove([ticket, lunch], "lunch", "sagrada", DATE)).toEqual({ kind: "moved", time: "09:45" });
  });

  it("starts a plain activity dragged below another once that one is over", () => {
    const breakfast = activity("breakfast", "08:00", { durationMin: 45 });
    const museum = activity("museum", "10:00", { durationMin: 90 });
    // Museum 10:00–11:30 + 15 min walk.
    expect(timeForMove([breakfast, museum], "breakfast", "museum", DATE)).toEqual({ kind: "moved", time: "11:45" });
  });

  it("does not push a check-out past its booked time", () => {
    const early = activity("early", "08:00", { durationMin: 0, category: "hotel", ...booking("lodging", "check_out", { end: { date: DATE, time: "10:30" } }) });
    const walk = activity("walk", "10:00", { durationMin: 60 });
    expect(timeForMove([early, walk], "early", "walk", DATE)).toEqual({ kind: "beyond_limit", limit: "10:30" });
  });

  it("does not pull a check-in before its booked time", () => {
    const checkin = activity("checkin", "16:00", { category: "hotel", ...booking("lodging", "check_in", { start: { date: DATE, time: "15:00" } }) });
    const coffee = activity("coffee", "15:30", { durationMin: 30 });
    expect(timeForMove([coffee, checkin], "checkin", "coffee", DATE)).toEqual({ kind: "beyond_limit", limit: "15:00" });
  });

  it("waits for the booked check-in time when the gap opens earlier", () => {
    const lunch = activity("lunch", "12:00", { durationMin: 60 });
    const checkin = activity("checkin", "11:00", { category: "hotel", ...booking("lodging", "check_in", { start: { date: DATE, time: "15:00" } }) });
    expect(timeForMove([checkin, lunch], "checkin", "lunch", DATE)).toEqual({ kind: "moved", time: "15:00" });
  });

  it("keeps the booked check-out time when the gap allows a later one", () => {
    const walk = activity("walk", "16:00", { durationMin: 60 });
    expect(timeForMove([walk, checkout], "checkout", "walk", DATE)).toEqual({ kind: "moved", time: "10:30" });
  });

  it("changes nothing when dropped on itself or on an unknown activity", () => {
    expect(timeForMove([flight, checkout], "checkout", "checkout", DATE)).toEqual({ kind: "unchanged" });
    expect(timeForMove([flight, checkout], "checkout", "nope", DATE)).toEqual({ kind: "unchanged" });
  });
});
