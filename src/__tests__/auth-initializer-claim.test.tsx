// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const session = vi.hoisted(() => ({ token: "tok" as string | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({}),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      order.push(`rpc:${fn}:${String(args.p_anon_id)}->${String(args.p_new_id)}`);
      return { data: 1, error: null };
    },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }),
    },
  },
}));

const { AuthInitializer } = await import("@/components/AuthInitializer");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useItineraryStore } = await import("@/store/use-itinerary-store");

const order = vi.hoisted(() => [] as string[]);
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
  fetchActiveTrip.mockClear();
  fetchAllTrips.mockClear();
  window.localStorage.clear();
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

  it("moves a guest's trips to the account they came back with from Google or Apple, before claiming and loading", async () => {
    window.localStorage.setItem("tachao_oauth_pending", JSON.stringify({ anonId: "anon-1", at: Date.now() }));
    useAuthStore.setState({ initialized: true, user: { id: "u-new", is_anonymous: false } as never, initialize: vi.fn(async () => {}) });
    render(<AuthInitializer />);
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
    expect(order.slice(0, 4)).toEqual(["rpc:transfer_anonymous_data:anon-1->u-new", "/api/share/claim", "fetchAllTrips", "fetchActiveTrip"]);
    expect(window.localStorage.getItem("tachao_oauth_pending")).toBeNull();
  });

  it("brings back a draft taken to Google or Apple as the active draft, so it is saved to the account", async () => {
    const draft = { id: "draft-1", name: "Roma", days: [{ id: "d1", date: "2027-05-10", city: "Roma", label: "", activities: [], userId: "anon-1" }], criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [] };
    window.localStorage.setItem("tachao_oauth_pending", JSON.stringify({ anonId: "anon-1", at: Date.now(), draft }));
    useAuthStore.setState({ initialized: true, user: { id: "u-new", is_anonymous: false } as never, initialize: vi.fn(async () => {}) });
    render(<AuthInitializer />);
    await waitFor(() => expect(useItineraryStore.getState().activeTripIsDraft).toBe(true));
    expect(useItineraryStore.getState().activeTrip).toMatchObject({ id: "draft-1", name: "Roma", userId: "u-new" });
    await waitFor(() => expect(fetchAllTrips).toHaveBeenCalled());
    expect(fetchActiveTrip).not.toHaveBeenCalled();
  });

  it("does not claim for anonymous guests", async () => {
    useAuthStore.setState({ initialized: true, user: { id: "g", is_anonymous: true } as never, initialize: vi.fn(async () => {}) });
    render(<AuthInitializer />);
    await waitFor(() => expect(fetchActiveTrip).toHaveBeenCalled());
    expect(order).not.toContain("/api/share/claim");
  });
});
