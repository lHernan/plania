// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const session = vi.hoisted(() => ({ token: "tok" as string | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }),
    },
  },
}));

const { AuthInitializer } = await import("@/components/AuthInitializer");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useItineraryStore } = await import("@/store/use-itinerary-store");

const order: string[] = [];
const fetchMock = vi.fn(async (url: string) => {
  order.push(url);
  return new Response(JSON.stringify({ tripIds: ["t-shared"] }));
});
const fetchActiveTrip = vi.fn(async () => {
  order.push("fetchActiveTrip");
});
const fetchAllTrips = vi.fn(async () => {
  order.push("fetchAllTrips");
});

beforeEach(() => {
  cleanup();
  order.length = 0;
  session.token = "tok";
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({
    activeTrip: null, activeTripIsDraft: false, hasFetched: false, loading: false,
    fetchActiveTrip, fetchAllTrips, clearData: vi.fn(), syncPendingMutations: vi.fn(async () => {}),
  });
});

describe("AuthInitializer", () => {
  it("claims the invitations for the signed-in email before loading the trips", async () => {
    useAuthStore.setState({ initialized: true, user: { id: "u-inv", is_anonymous: false } as never, initialize: vi.fn(async () => {}) });
    render(<AuthInitializer />);
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
    expect(order.slice(0, 3)).toEqual(["/api/share/claim", "fetchAllTrips", "fetchActiveTrip"]);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("does not claim for anonymous guests", async () => {
    useAuthStore.setState({ initialized: true, user: { id: "g", is_anonymous: true } as never, initialize: vi.fn(async () => {}) });
    render(<AuthInitializer />);
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
    expect(order).not.toContain("/api/share/claim");
  });
});
