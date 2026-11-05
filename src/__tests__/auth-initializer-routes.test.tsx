// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), usePathname: () => nav.pathname }));
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
    activeTrip: null, activeTripIsDraft: false, hasFetched: false, loading: false,
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

  it("opens the active trip's itinerary from the landing and from /trips", async () => {
    for (const pathname of ["/", "/trips"]) {
      nav.pathname = pathname;
      nav.push.mockClear();
      const view = render(<AuthInitializer />);
      act(() => useItineraryStore.setState({ activeTrip: trip("t-9") as never, hasFetched: true }));
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/trips/t-9"));
      view.unmount();
      act(() => useItineraryStore.setState({ activeTrip: null, hasFetched: false }));
    }
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
});
