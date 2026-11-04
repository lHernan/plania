// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({ pathname: "/trips/t-b/wallet" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));
vi.mock("@/components/CriticalReservationsPanel", () => ({ CriticalReservationsPanel: () => null }));
vi.mock("@/components/ShoppingListPanel", () => ({ ShoppingListPanel: () => null }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const fetchActiveTrip = vi.fn(async () => {});

function trip(id: string) {
  return { ...makeTrip([makeDay("d1", [])]), id, userId: "me" };
}

async function mountWith(state: { activeTrip: ReturnType<typeof trip> | null; loading?: boolean; hasFetched?: boolean }) {
  useItineraryStore.setState({
    activeTrip: state.activeTrip,
    activeDayId: state.activeTrip ? "d1" : "",
    loading: state.loading ?? false,
    hasFetched: state.hasFetched ?? Boolean(state.activeTrip),
    error: null,
    fetchActiveTrip,
  } as never);
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "me@x.io" } } as never);
  renderWithI18n(<TripView />);
  await act(async () => {});
}

beforeEach(() => {
  mockMatchMedia();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  nav.pathname = "/trips/t-b/wallet";
  fetchActiveTrip.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TripView mount fetch on a trip route", () => {
  it("on a cold load asks only for the trip in the URL", async () => {
    await mountWith({ activeTrip: null });
    expect(fetchActiveTrip.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchActiveTrip.mock.calls as unknown[][]) expect(call[0]).toBe("t-b");
  });

  it("does not refetch when the URL trip is already open (remount after a switch)", async () => {
    await mountWith({ activeTrip: trip("t-b") });
    expect(fetchActiveTrip).not.toHaveBeenCalled();
  });

  it("leaves another loaded trip to the route sync instead of refetching it", async () => {
    await mountWith({ activeTrip: trip("t-a") });
    expect(fetchActiveTrip).not.toHaveBeenCalled();
  });

  it("does not start a second fetch while the URL trip is loading", async () => {
    await mountWith({ activeTrip: null, loading: true });
    expect(fetchActiveTrip).not.toHaveBeenCalled();
  });
});
