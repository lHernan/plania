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

  it("selects a day a link inside the app puts in the URL after the trip is open", async () => {
    const view = render(<TripRouteSync />);
    nav.search = "day=2026-11-16";
    window.history.replaceState(null, "", "/trips/t1?day=2026-11-16");
    view.rerender(<TripRouteSync />);
    await waitFor(() => expect(useItineraryStore.getState().activeDayId).toBe("t1-d2"));
    expect(window.location.search).toBe("?day=2026-11-16");
  });

  it("reads the trip from the address, not from a page cached for another trip", async () => {
    // Offline, the service worker may serve trip t9's cached page at /trips/t1: params say t9.
    nav.tripId = "t9";
    nav.pathname = "/trips/t1";
    render(<TripRouteSync />);
    await act(async () => {});
    expect(switchTrip).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("asks the service worker to keep the trip page for offline use, once per page", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", { value: { controller: { postMessage } }, configurable: true });
    nav.pathname = "/trips/t1/map";
    const view = render(<TripRouteSync />);
    view.rerender(<TripRouteSync />);
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith({ type: "CACHE_PAGE", url: `${window.location.origin}/trips/t1/map` });
  });

  it("does not ask to cache pages while offline", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", { value: { controller: { postMessage } }, configurable: true });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    render(<TripRouteSync />);
    await act(async () => {});
    expect(postMessage).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("writes the selected day to the URL", async () => {
    render(<TripRouteSync />);
    act(() => useItineraryStore.setState({ activeDayId: "t1-d2" }));
    await waitFor(() => expect(window.location.search).toBe("?day=2026-11-16"));
  });

  it("names the days of an undated trip by number in the URL, never by their placeholder dates", async () => {
    useItineraryStore.setState({ activeTrip: { ...trip("t1"), travelContext: { version: 1, undated: true } } as never, activeDayId: "t1-d1" });
    nav.search = "day=2";
    window.history.replaceState(null, "", "/trips/t1?day=2");
    render(<TripRouteSync />);
    await waitFor(() => expect(useItineraryStore.getState().activeDayId).toBe("t1-d2"));
    act(() => useItineraryStore.setState({ activeDayId: "t1-d1" }));
    await waitFor(() => expect(window.location.search).toBe("?day=1"));
  });

  it("still opens an undated trip's day from an old link with its placeholder date", async () => {
    useItineraryStore.setState({ activeTrip: { ...trip("t1"), travelContext: { version: 1, undated: true } } as never, activeDayId: "t1-d1" });
    nav.search = "day=2026-11-16";
    render(<TripRouteSync />);
    await waitFor(() => expect(useItineraryStore.getState().activeDayId).toBe("t1-d2"));
    await waitFor(() => expect(window.location.search).toBe("?day=2"));
  });
});
