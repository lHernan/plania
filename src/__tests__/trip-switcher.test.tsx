// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

const { TripSwitcher } = await import("@/components/TripSwitcher");
const { useItineraryStore } = await import("@/store/use-itinerary-store");

beforeEach(() => {
  mockMatchMedia();
  useItineraryStore.setState({
    trips: [{ id: "t1", name: "Tokyo", startDate: "2000-01-01", endDate: "2999-12-31", dayCount: 3, activityCount: 4 }],
    sharedTrips: [],
    activeTrip: null,
    loading: false,
    fetchAllTrips: vi.fn(async () => {}),
    fetchSharedTrips: vi.fn(async () => {}),
  });
});
afterEach(cleanup);

describe("TripSwitcher", () => {
  it("links to the full trip list", () => {
    renderWithI18n(<TripSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Selecciona un viaje/ }));
    expect(screen.getByRole("link", { name: "Ver todos los viajes" }).getAttribute("href")).toBe("/trips");
  });

  it("names the link in English", () => {
    renderWithI18n(<TripSwitcher />, "en");
    fireEvent.click(screen.getByRole("button", { name: /Select a Trip/ }));
    expect(screen.getByRole("link", { name: "See all trips" }).getAttribute("href")).toBe("/trips");
  });
});
