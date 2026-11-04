// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ tripId: "t1", pathname: "/trips/t1", search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ tripId: nav.tripId }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({}), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } },
}));

const { TripRouteSync } = await import("@/components/TripRouteSync");
const { useItineraryStore } = await import("@/store/use-itinerary-store");

const day = (id: string, date: string) => ({ id, date, city: "", label: "", activities: [], userId: "u" });
const trip = (id: string) => ({
  id, name: id, criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [],
  days: [day(`${id}-d1`, "2026-11-15"), day(`${id}-d2`, "2026-11-16")],
});
const switchTrip = vi.fn(async (id: string) => {
  useItineraryStore.setState({ activeTrip: trip(id) as never, activeDayId: `${id}-d1` });
});

beforeEach(() => {
  cleanup();
  nav.replace.mockClear();
  switchTrip.mockClear();
  nav.tripId = "t1";
  nav.pathname = "/trips/t1";
  nav.search = "";
  window.history.replaceState(null, "", "/trips/t1");
  useItineraryStore.setState({ activeTrip: trip("t1") as never, activeDayId: "t1-d1", hasFetched: true, switchTrip });
});

describe("TripRouteSync", () => {
  it("does nothing when the URL and the active trip agree", () => {
    render(<TripRouteSync />);
    expect(switchTrip).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("opens the trip a new URL names", async () => {
    const view = render(<TripRouteSync />);
    nav.tripId = "t2";
    nav.pathname = "/trips/t2/wallet";
    view.rerender(<TripRouteSync />);
    await waitFor(() => expect(switchTrip).toHaveBeenCalledWith("t2"));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("moves the URL to a trip opened from inside the app, keeping the section", async () => {
    nav.pathname = "/trips/t1/map";
    render(<TripRouteSync />);
    act(() => useItineraryStore.setState({ activeTrip: trip("t3") as never }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/trips/t3/map"));
    expect(switchTrip).not.toHaveBeenCalled();
  });

  it("follows the trip the store opened when the URL's trip is not available", async () => {
    switchTrip.mockImplementationOnce(async () => {
      useItineraryStore.setState({ activeTrip: trip("t-fallback") as never });
    });
    nav.tripId = "t-gone";
    nav.pathname = "/trips/t-gone/overview";
    render(<TripRouteSync />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/trips/t-fallback/overview"));
    expect(switchTrip).toHaveBeenCalledTimes(1);
  });

  it("selects the day named in the URL", async () => {
    nav.search = "day=2026-11-16";
    render(<TripRouteSync />);
    await waitFor(() => expect(useItineraryStore.getState().activeDayId).toBe("t1-d2"));
  });

  it("writes the selected day to the URL", async () => {
    render(<TripRouteSync />);
    act(() => useItineraryStore.setState({ activeDayId: "t1-d2" }));
    await waitFor(() => expect(window.location.search).toBe("?day=2026-11-16"));
  });
});
