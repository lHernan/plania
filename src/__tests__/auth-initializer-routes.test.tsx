// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => nav.pathname }));
vi.mock("@/lib/share/claim-client", () => ({ claimPendingInvitations: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

const { AuthInitializer } = await import("@/components/AuthInitializer");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useItineraryStore } = await import("@/store/use-itinerary-store");

const fetchActiveTrip = vi.fn(async (..._args: unknown[]) => {});
const trip = (id: string) => ({ id, name: id, days: [], criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [] });

beforeEach(() => {
  cleanup();
  nav.push.mockClear();
  fetchActiveTrip.mockClear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({
    trips: [], activeTrip: null, activeTripIsDraft: false, hasFetched: false, loading: false,
    fetchActiveTrip, fetchAllTrips: vi.fn(async () => {}), clearData: vi.fn(), syncPendingMutations: vi.fn(async () => {}),
  });
  // Anonymous: skips the invitation claim, which needs a session.
  useAuthStore.setState({ initialized: true, user: { id: `g-${Math.random()}`, is_anonymous: true } as never, initialize: vi.fn(async () => {}) });
});

describe("AuthInitializer routes", () => {
  it("loads the trip named in the URL", async () => {
    nav.pathname = "/trips/t-2/wallet";
    render(<AuthInitializer />);
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalledWith("t-2"));
  });

  it("lets the selection pick the trip when the URL names none", async () => {
    nav.pathname = "/";
    render(<AuthInitializer />);
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
    expect(fetchActiveTrip.mock.calls[0]).toEqual([]);
  });

  it("opens the active trip's itinerary from the landing", async () => {
    nav.pathname = "/";
    render(<AuthInitializer />);
    act(() => useItineraryStore.setState({ activeTrip: trip("t-9") as never, hasFetched: true }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/trips/t-9"));
  });

  it("keeps /trips as the trip list instead of opening the active trip", async () => {
    nav.pathname = "/trips";
    render(<AuthInitializer />);
    act(() => useItineraryStore.setState({ activeTrip: trip("t-9") as never, hasFetched: true }));
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("does not move away from a trip section", async () => {
    nav.pathname = "/trips/t-9/map";
    render(<AuthInitializer />);
    act(() => useItineraryStore.setState({ activeTrip: trip("t-9") as never, hasFetched: true }));
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("sends a trip URL back to the landing when there are no trips", async () => {
    nav.pathname = "/trips/t-9/map";
    render(<AuthInitializer />);
    act(() => useItineraryStore.setState({ activeTrip: null, hasFetched: true, loading: false }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
  });

  it("sends an anonymous visitor on /trips with no trips back to the landing", async () => {
    nav.pathname = "/trips";
    render(<AuthInitializer />);
    act(() => useItineraryStore.setState({ activeTrip: null, hasFetched: true, loading: false }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/"));
  });

  describe("registered user", () => {
    beforeEach(() => {
      useAuthStore.setState({ user: { id: `r-${Math.random()}`, is_anonymous: false, email: "me@x.io" } as never });
    });

    it.each(["/", "/trips/t-9/map"])("with no trips goes from %s to the empty trip list", async (pathname) => {
      nav.pathname = pathname;
      render(<AuthInitializer />);
      act(() => useItineraryStore.setState({ trips: [], activeTrip: null, hasFetched: true, loading: false }));
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/trips"));
      expect(nav.push).not.toHaveBeenCalledWith("/");
    });

    it("with no trips stays on the trip list", async () => {
      nav.pathname = "/trips";
      render(<AuthInitializer />);
      act(() => useItineraryStore.setState({ trips: [], activeTrip: null, hasFetched: true, loading: false }));
      await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("signing in on the landing with trips opens the selected trip", async () => {
      nav.pathname = "/";
      render(<AuthInitializer />);
      act(() => useItineraryStore.setState({ activeTrip: trip("t-3") as never, hasFetched: true }));
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/trips/t-3"));
    });

    it("waits for the selected trip while its trip list is already loaded", async () => {
      nav.pathname = "/";
      render(<AuthInitializer />);
      const summary = { id: "t-3", name: "t-3", dayCount: 1, activityCount: 0 };
      act(() => useItineraryStore.setState({ trips: [summary], activeTrip: null, hasFetched: true, loading: false }));
      await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
      expect(nav.push).not.toHaveBeenCalledWith("/trips");
    });

    it("stays put when offline with no trips", async () => {
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      nav.pathname = "/trips/t-9";
      render(<AuthInitializer />);
      act(() => useItineraryStore.setState({ trips: [], activeTrip: null, hasFetched: true, loading: false }));
      await new Promise((r) => setTimeout(r, 20));
      expect(nav.push).not.toHaveBeenCalled();
    });
  });
});
