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
// The viewer loads PDF tooling; a stub shows which file and title it was opened with.
vi.mock("@/components/DocumentViewer", () => ({
  DocumentViewer: ({ file, activityTitle }: { file: { fileName: string }; activityTitle: string }) => (
    <div data-testid="viewer">{file.fileName} · {activityTitle}</div>
  ),
}));
// The travel tools and the packing list fetch on mount; stubs show where they are rendered.
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => <section data-testid="arrival" /> }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => <section data-testid="payments" /> }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => <section data-testid="currency" /> }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => <section data-testid="emergency" /> }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => <section data-testid="packing" /> }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { TOUR_STEPS } = await import("@/lib/tour/steps");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const boardingPass = {
  id: "f1",
  activityId: "a2",
  tripId: "t",
  userId: "me",
  fileUrl: "https://files/pass.pdf",
  filePath: "pass.pdf",
  fileType: "pdf" as const,
  fileName: "pass.pdf",
  createdAt: "",
};

function seed(ownerId: string) {
  const flight = makeActivity("a2", {
    title: "Flight home",
    origin: "booking",
    booking: { version: 1, type: "flight", role: "single", groupId: "g1", title: "Tokyo → Madrid", fieldStatus: {} },
    files: [boardingPass],
  });
  const day = makeDay("d1", [makeActivity("a1", { expectedCost: 40 })]);
  const second = { ...makeDay("d2", [flight]), date: "2026-10-27" };
  const trip = { ...makeTrip([day, second]), id: "t", userId: ownerId };
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
  it("shows the timeline with the day's activities on the itinerary", async () => {
    await renderAt("/trips/t");
    const timeline = document.querySelector('[data-tour="timeline"]') as HTMLElement;
    expect(within(timeline).getByText("Activity a1")).toBeTruthy();
    expect(screen.queryByTestId("day-map")).toBeNull();
  });

  it("no longer shows the sidebar blocks on the itinerary", async () => {
    await renderAt("/trips/t");
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector('[data-tour="ai-shortcuts"]')).toBeNull();
    expect(document.querySelector('[data-tour="travel-tools"]')).toBeNull();
    expect(screen.queryByTestId("reservations")).toBeNull();
    expect(screen.queryByTestId("shopping")).toBeNull();
    expect(screen.queryByText("Presupuesto")).toBeNull();
    expect(screen.queryByTestId("packing")).toBeNull();
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

  it("shows the overview as four tabs", async () => {
    await renderAt("/trips/t/overview");
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Resumen", "Maleta", "Compras", "Herramientas"]);
  });

  describe("every former sidebar feature stays reachable", () => {
    it("critical reservations, in the wallet", async () => {
      await renderAt("/trips/t/wallet");
      expect(screen.getByTestId("reservations")).toBeTruthy();
    });

    it("AI quick actions with Day Genius, in the overview summary", async () => {
      await renderAt("/trips/t/overview");
      const ai = document.querySelector('[data-tour="ai-shortcuts"]') as HTMLElement;
      expect(within(ai).getByRole("button", { name: /Genio del Dia/ })).toBeTruthy();
    });

    it("the trip context editor, in the overview summary", async () => {
      await renderAt("/trips/t/overview");
      fireEvent.click(screen.getByRole("button", { name: "Editar contexto del viaje" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("booking import, in the overview summary", async () => {
      await renderAt("/trips/t/overview");
      const ai = document.querySelector('[data-tour="ai-shortcuts"]') as HTMLElement;
      expect(within(ai).getByRole("button", { name: "Importar reservas" })).toBeTruthy();
    });

    it("notes import to the timeline, in the overview summary", async () => {
      await renderAt("/trips/t/overview");
      expect(screen.getByRole("button", { name: "Sincronizar a la Linea de Tiempo" })).toBeTruthy();
    });

    it("the budget, in the overview summary", async () => {
      await renderAt("/trips/t/overview");
      expect(within(screen.getByRole("tabpanel")).getByText("Presupuesto")).toBeTruthy();
    });

    it("sharing, in the overview summary for the owner only", async () => {
      await renderAt("/trips/t/overview");
      expect(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Compartir" })).toBeTruthy();
      cleanup();
      await renderAt("/trips/t/overview", "owner");
      expect(within(screen.getByRole("tabpanel")).queryByRole("button", { name: "Compartir" })).toBeNull();
    });

    it("the packing list, in the packing tab", async () => {
      await renderAt("/trips/t/overview");
      fireEvent.click(screen.getByRole("tab", { name: "Maleta" }));
      expect(within(screen.getByRole("tabpanel")).getByTestId("packing")).toBeTruthy();
    });

    it("the shopping list, in the shopping tab", async () => {
      await renderAt("/trips/t/overview");
      fireEvent.click(screen.getByRole("tab", { name: "Compras" }));
      expect(within(screen.getByRole("tabpanel")).getByTestId("shopping")).toBeTruthy();
    });

    it("arrival, payments, currency and emergencies, in the tools tab", async () => {
      await renderAt("/trips/t/overview");
      fireEvent.click(screen.getByRole("tab", { name: "Herramientas" }));
      const panel = screen.getByRole("tabpanel");
      expect(panel.querySelector('[data-tour="travel-tools"]')).not.toBeNull();
      for (const id of ["arrival", "payments", "currency", "emergency"]) {
        expect(within(panel).getByTestId(id)).toBeTruthy();
      }
    });
  });

  it("shows the wallet bookings tab with the to-book block under it", async () => {
    await renderAt("/trips/t/wallet");
    expect(screen.getByRole("tab", { name: "Reservas" }).getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("article", { name: "Tokyo → Madrid" })).toBeTruthy();
    expect(within(panel).getByTestId("reservations")).toBeTruthy();
  });

  it("opens a booking document from the wallet in one tap", async () => {
    await renderAt("/trips/t/wallet");
    fireEvent.click(screen.getByRole("button", { name: /pass.pdf/ }));
    expect(screen.getByTestId("viewer").textContent).toBe("pass.pdf · Flight home");
  });

  it("shows a booking in the itinerary on its day", async () => {
    await renderAt("/trips/t/wallet");
    fireEvent.click(screen.getByRole("button", { name: "Ver en el itinerario" }));
    expect(nav.push).toHaveBeenCalledWith("/trips/t?day=2026-10-27");
    expect(useItineraryStore.getState().activeDayId).toBe("d2");
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

  describe("activity card chips on the itinerary", () => {
    async function showFlightDay(ownerId = "me") {
      nav.pathname = "/trips/t";
      seed(ownerId);
      useItineraryStore.setState({ activeDayId: "d2" });
      renderWithI18n(<TripView />);
      await act(async () => {});
    }

    it("opens the boarding pass in one tap from the itinerary, for invitees too", async () => {
      await showFlightDay("owner");
      fireEvent.click(screen.getByRole("button", { name: "Abrir el pase de «Flight home»" }));
      expect(screen.getByTestId("viewer").textContent).toBe("pass.pdf · Flight home");
    });

    it("the booking chip goes to the wallet keeping the day", async () => {
      await showFlightDay();
      fireEvent.click(screen.getByRole("button", { name: "Ver la reserva de «Flight home» en la Cartera" }));
      expect(nav.push).toHaveBeenCalledWith("/trips/t/wallet?day=2026-10-27");
    });
  });

  describe("header account menu", () => {
    it("moves theme, language and sign out into the avatar menu, keeping share in the header", async () => {
      await renderAt("/trips/t");
      const signOut = vi.fn(async () => {});
      act(() => useAuthStore.setState({ signOut } as never));
      const header = document.querySelector("header") as HTMLElement;
      expect(within(header).queryByRole("button", { name: "ES" })).toBeNull();
      expect(within(header).queryByRole("button", { name: "Ver el tour de la app" })).toBeNull();
      expect(document.querySelector('[data-tour="share"]')).not.toBeNull();
      fireEvent.click(within(header).getByRole("button", { name: "Menú de la cuenta" }));
      const menu = screen.getByRole("menu");
      expect(menu.textContent).toContain("me@x.io");
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Cerrar sesión" }));
      expect(signOut).toHaveBeenCalledTimes(1);
    });

    it("keeps the save button for anonymous visitors and offers sign in in the menu", async () => {
      await renderAt("/trips/t");
      act(() => useAuthStore.setState({ user: { id: "anon", is_anonymous: true } } as never));
      const header = document.querySelector("header") as HTMLElement;
      expect(within(header).getByRole("button", { name: "Guardar" })).toBeTruthy();
      fireEvent.click(within(header).getByRole("button", { name: "Menú de la cuenta" }));
      expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Iniciar sesión" })).toBeTruthy();
    });
  });

  it("has every tour step's anchor on the itinerary, where the tour runs", async () => {
    await renderAt("/trips/t");
    const missing = TOUR_STEPS.filter((step) => !step.anchorless && !document.querySelector(`[data-tour="${step.id}"]`));
    expect(missing.map((step) => step.id)).toEqual([]);
  });

  it("points the wallet and trip tour steps at their section links", async () => {
    await renderAt("/trips/t");
    for (const [anchor, href] of [["section-wallet", "/trips/t/wallet"], ["section-overview", "/trips/t/overview"]]) {
      const links = document.querySelectorAll(`[data-tour="${anchor}"]`);
      expect(links).toHaveLength(2);
      links.forEach((link) => expect(link.getAttribute("href")).toBe(href));
    }
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
