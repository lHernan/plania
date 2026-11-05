// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({ pathname: "/trips/t", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

// The map is a Leaflet component; a stub records the props the section passes.
const map = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function DayMapStub(props: Record<string, unknown>) {
      map.props = props;
      return <div data-testid="day-map">{props.floatingActions as React.ReactNode}</div>;
    },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

// Leaves that talk to the network or the browser; not what this test is about.
vi.mock("@/components/CriticalReservationsPanel", () => ({
  CriticalReservationsPanel: () => <section data-testid="reservations" />,
}));
vi.mock("@/components/ShoppingListPanel", () => ({
  ShoppingListPanel: () => <section data-testid="shopping" />,
}));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

function seed(ownerId: string) {
  const day = makeDay("d1", [makeActivity("a1")]);
  const trip = { ...makeTrip([day]), id: "t", userId: ownerId };
  useItineraryStore.setState({
    activeTrip: trip,
    activeDayId: "d1",
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
  } as never);
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "me@x.io" } } as never);
}

async function renderAt(pathname: string, ownerId = "me") {
  nav.pathname = pathname;
  seed(ownerId);
  renderWithI18n(<TripView />);
  await act(async () => {});
}

beforeEach(() => {
  mockMatchMedia();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  map.props = null;
  nav.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TripView sections", () => {
  it("shows the timeline and the sidebar on the itinerary", async () => {
    await renderAt("/trips/t");
    expect(document.querySelector('[data-tour="timeline"]')).not.toBeNull();
    expect(screen.getByTestId("reservations")).toBeTruthy();
    expect(screen.queryByTestId("day-map")).toBeNull();
  });

  it("fills the map section with the day's map, editable for the owner", async () => {
    await renderAt("/trips/t/map");
    expect(screen.getByTestId("day-map")).toBeTruthy();
    expect(map.props?.dayId).toBe("d1");
    expect(map.props?.canEdit).toBe(true);
    expect(document.querySelector('[data-tour="timeline"]')).toBeNull();
  });

  it("shows the map read-only to an invitee", async () => {
    await renderAt("/trips/t/map", "owner");
    expect(screen.getByTestId("day-map")).toBeTruthy();
    expect(map.props?.canEdit).toBe(false);
  });

  it("closing the map returns to the itinerary with the day", async () => {
    await renderAt("/trips/t/map");
    act(() => (map.props?.onClose as () => void)());
    expect(nav.push).toHaveBeenCalledWith("/trips/t?day=2026-10-26");
  });

  it("the map button in the day bar goes to the map section, for invitees too", async () => {
    await renderAt("/trips/t", "owner");
    const dayTools = document.querySelector('[data-tour="day-tools"]') as HTMLElement;
    fireEvent.click(within(dayTools).getByRole("button", { name: /mapa/i }));
    expect(nav.push).toHaveBeenCalledWith("/trips/t/map?day=2026-10-26");
  });

  it("shows the reservations on the wallet and the other blocks on the overview", async () => {
    await renderAt("/trips/t/wallet");
    expect(screen.getByTestId("reservations")).toBeTruthy();
    expect(screen.queryByTestId("shopping")).toBeNull();
    cleanup();
    await renderAt("/trips/t/overview");
    expect(screen.getByTestId("shopping")).toBeTruthy();
    expect(screen.queryByTestId("reservations")).toBeNull();
    expect(document.querySelector('[data-tour="travel-tools"]')).not.toBeNull();
  });

  it("offers the add button only on the itinerary and the agent everywhere", async () => {
    await renderAt("/trips/t");
    expect(screen.getByRole("button", { name: "Agregar actividad" })).toBeTruthy();
    cleanup();
    await renderAt("/trips/t/overview");
    expect(screen.queryByRole("button", { name: "Agregar actividad" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /agente/i }).length).toBeGreaterThan(0);
    cleanup();
    await renderAt("/trips/t/map");
    expect(screen.queryByRole("button", { name: "Agregar actividad" })).toBeNull();
    expect(within(screen.getByTestId("day-map")).getByRole("button", { name: /agente/i })).toBeTruthy();
  });

  it("renders the section bar and the desktop tabs", async () => {
    await renderAt("/trips/t/wallet");
    const navs = screen.getAllByRole("navigation", { name: "Secciones del viaje" });
    expect(navs).toHaveLength(2);
    for (const n of navs) {
      expect(within(n).getByRole("link", { current: "page" }).getAttribute("href")).toBe("/trips/t/wallet");
    }
  });
});
