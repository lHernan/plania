// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ token: "tok" }), useRouter: () => ({ push: nav.push }), usePathname: () => "/share/tok" }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: "tok-session" } } }),
    },
  },
}));

const { default: SharePage } = await import("@/app/share/[token]/page");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useItineraryStore } = await import("@/store/use-itinerary-store");

const switchTrip = vi.fn(async () => {});
const fetchMock = vi.fn(async (url: string) => {
  if (url === "/api/share/tok") return new Response(JSON.stringify({ tripId: "t1", tripName: "La Palma", role: "viewer", email: null, accepted: false }));
  if (url === "/api/share/tok/trip") return new Response(JSON.stringify({ trip: { id: "t1", name: "La Palma" }, role: "viewer", days: [], activities: [], reservations: [] }));
  if (url === "/api/share/tok/accept") return new Response(JSON.stringify({ success: true, tripId: "t1", role: "viewer" }));
  throw new Error(url);
});

beforeEach(() => {
  nav.push.mockClear();
  switchTrip.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  useItineraryStore.setState({ switchTrip });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("share link page", () => {
  it("takes a signed-in person straight to the trip in the app", async () => {
    useAuthStore.setState({ user: { id: "u-inv", is_anonymous: false } as never });
    renderWithI18n(<SharePage />);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/trips"));
    expect(fetchMock).toHaveBeenCalledWith("/api/share/tok/accept", expect.objectContaining({ method: "POST" }));
    expect(switchTrip).toHaveBeenCalledWith("t1");
    expect(screen.queryByText("La Palma")).toBeNull();
  });

  it("shows the preview to visitors without an account", async () => {
    useAuthStore.setState({ user: null });
    renderWithI18n(<SharePage />);
    expect(await screen.findByText("La Palma")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/share/tok/accept", expect.anything());
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("does not auto-accept for anonymous guests", async () => {
    useAuthStore.setState({ user: { id: "g", is_anonymous: true } as never });
    renderWithI18n(<SharePage />);
    expect(await screen.findByText("La Palma")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/share/tok/accept", expect.anything());
  });
});
