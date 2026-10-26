import { describe, expect, it } from "vitest";
import { resolveTripSelection, type TripSelectionInputTrip } from "@/lib/trip-selection";

const trip = (id: string, start: string, end: string, isFavorite = false): TripSelectionInputTrip => ({
  id,
  name: id,
  start_date: start,
  end_date: end,
  is_favorite: isFavorite,
  created_at: "2026-01-01T00:00:00Z",
});

describe("resolveTripSelection i18n keys", () => {
  it("returns i18n keys for section titles while keeping the English fallbacks", () => {
    const { ui } = resolveTripSelection({ current_date: "2026-10-26", trips: [] });

    expect(ui.sections.map((section) => section.title_key)).toEqual([
      "trip_selection_current_trip",
      "trip_selection_upcoming_trips",
      "trip_selection_past_trips",
    ]);
    expect(ui.sections.map((section) => section.title)).toEqual(["Current Trip", "Upcoming Trips", "Past Trips"]);
  });

  it("returns the empty-state key and no selection label when there are no trips", () => {
    const { ui } = resolveTripSelection({ current_date: "2026-10-26", trips: [] });

    expect(ui.hints.empty_state_key).toBe("trip_selection_empty_state");
    expect(ui.hints.empty_state).toBe("No trips yet");
    expect(ui.hints.default_selection_label_key).toBeNull();
    expect(ui.hints.default_selection_label).toBe("");
  });

  it.each([
    [[trip("fav", "2026-12-01", "2026-12-05", true), trip("now", "2026-10-20", "2026-10-30")], "trip_selection_reason_favorite", "Favorite trip selected"],
    [[trip("now", "2026-10-20", "2026-10-30")], "trip_selection_reason_active_trip", "Active trip selected"],
    [[trip("soon", "2026-11-01", "2026-11-05")], "trip_selection_reason_closest_upcoming", "Closest upcoming trip selected"],
    [[trip("old", "2026-01-01", "2026-01-05")], "trip_selection_reason_most_recent_past", "Most recent past trip selected"],
  ])("returns the selection label key for each reason (%#)", (trips, key, label) => {
    const { ui } = resolveTripSelection({ current_date: "2026-10-26", trips });

    expect(ui.hints.default_selection_label_key).toBe(key);
    expect(ui.hints.default_selection_label).toBe(label);
    expect(ui.hints.empty_state_key).toBeNull();
    expect(ui.hints.empty_state).toBeNull();
  });
});
