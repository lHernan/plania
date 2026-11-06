// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { Activity } from "@/lib/types";

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
    expect((map.props?.floatingActions as { props: { onAdd?: unknown } }).props.onAdd).toBeUndefined();
  });

  it("keeps the add button in the map's dock for the owner, as the old mobile map did", async () => {
    await renderAt("/trips/t/map");
    expect(typeof (map.props?.floatingActions as { props: { onAdd?: unknown } }).props.onAdd).toBe("function");
  });

  it("closing the map returns to the itinerary with the day", async () => {
    await renderAt("/trips/t/map");
    act(() => (map.props?.onClose as () => void)());
    expect(nav.push).toHaveBeenCalledWith("/trips/t?day=2026-10-26");
  });

  describe("a day picked in the date strip", () => {
    const pickSecondDay = () => {
      const strip = document.querySelector('[data-tour="day-strip"]') as HTMLElement;
      fireEvent.click(within(strip).getByRole("button", { name: /27/ }));
    };

    it.each(["wallet", "overview"])("opens its activities on the itinerary from the %s, which do not depend on the day", async (section) => {
      await renderAt(`/trips/t/${section}`);
      pickSecondDay();
      expect(useItineraryStore.getState().activeDayId).toBe("d2");
      expect(nav.push).toHaveBeenCalledWith("/trips/t?day=2026-10-27");
    });

    it.each(["/trips/t", "/trips/t/map"])("stays on %s, which already shows the picked day", async (pathname) => {
      await renderAt(pathname);
      pickSecondDay();
      expect(useItineraryStore.getState().activeDayId).toBe("d2");
      expect(nav.push).not.toHaveBeenCalled();
    });
  });

  it("the map button in the day bar goes to the map section, for invitees too", async () => {
    await renderAt("/trips/t", "owner");
    const dayTools = document.querySelector('[data-tour="day-tools"]') as HTMLElement;
    fireEvent.click(within(dayTools).getByRole("button", { name: /mapa/i }));
    expect(nav.push).toHaveBeenCalledWith("/trips/t/map?day=2026-10-26");
  });

  it("an invitee opening the map of a day without a city goes to the read-only map, never to the city prompt", async () => {
    nav.pathname = "/trips/t";
    seed("owner");
    useItineraryStore.setState((s) => ({
      activeTrip: s.activeTrip && { ...s.activeTrip, days: s.activeTrip.days.map((d) => (d.id === "d1" ? { ...d, city: "" } : d)) },
    }));
    renderWithI18n(<TripView />);
    await act(async () => {});
    const dayTools = document.querySelector('[data-tour="day-tools"]') as HTMLElement;
    fireEvent.click(within(dayTools).getByRole("button", { name: /mapa/i }));
    expect(screen.queryByText("Escribir la ciudad")).toBeNull();
    expect(nav.push).toHaveBeenCalledWith("/trips/t/map?day=2026-10-26");
  });

  it("the owner still gets the city prompt for a day without a city", async () => {
    nav.pathname = "/trips/t";
    seed("me");
    useItineraryStore.setState((s) => ({
      activeTrip: s.activeTrip && { ...s.activeTrip, days: s.activeTrip.days.map((d) => (d.id === "d1" ? { ...d, city: "" } : d)) },
    }));
    renderWithI18n(<TripView />);
    await act(async () => {});
    const dayTools = document.querySelector('[data-tour="day-tools"]') as HTMLElement;
    fireEvent.click(within(dayTools).getByRole("button", { name: /mapa/i }));
    expect(screen.getByText("Escribir la ciudad")).toBeTruthy();
  });

  it("shows the overview as four tabs", async () => {
    // Before the trip ends: an ended trip adds the Recuerdos tab (trip-view-memories.test.tsx).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T10:00:00"));
    try {
      await renderAt("/trips/t/overview");
      const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent)).toEqual(["Resumen", "Maleta", "Compras", "Herramientas"]);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("every former sidebar feature stays reachable", () => {
    it("critical reservations, in the wallet", async () => {
      await renderAt("/trips/t/wallet");
      expect(screen.getByTestId("reservations")).toBeTruthy();
    });

    async function openTachi() {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "¡Pregúntale a Tachi!" }));
      });
      return screen.getByRole("complementary", { name: "Tachi" });
    }

    it("the day planner, as Tachi's \"Rearrange the day\" on the itinerary", async () => {
      await renderAt("/trips/t");
      expect(within(await openTachi()).getByRole("button", { name: "Reorganizar el día" })).toBeTruthy();
    });

    it("the trip context editor, in the overview summary", async () => {
      await renderAt("/trips/t/overview");
      fireEvent.click(screen.getByRole("button", { name: "Editar contexto del viaje" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("booking import, as a Tachi action on the itinerary", async () => {
      await renderAt("/trips/t");
      const sheet = await openTachi();
      fireEvent.click(within(sheet).getByRole("button", { name: "Más acciones" }));
      expect(within(sheet).getByRole("button", { name: "Importar reservas" })).toBeTruthy();
    });

    it("notes import to the timeline, inside Tachi on the itinerary", async () => {
      await renderAt("/trips/t");
      const sheet = await openTachi();
      fireEvent.click(within(sheet).getByRole("button", { name: "Importar notas" }));
      expect(within(sheet).getByRole("button", { name: "Sincronizar a la Linea de Tiempo" })).toBeTruthy();
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

  it("offers the add button on the itinerary and inside the map dock, and Tachi everywhere", async () => {
    await renderAt("/trips/t");
    expect(screen.getByRole("button", { name: "Agregar actividad" })).toBeTruthy();
    cleanup();
    await renderAt("/trips/t/overview");
    expect(screen.queryByRole("button", { name: "Agregar actividad" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "¡Pregúntale a Tachi!" }).length).toBeGreaterThan(0);
    cleanup();
    await renderAt("/trips/t/map");
    // On the map, both live in its bottom dock, as on the old mobile map.
    expect(within(screen.getByTestId("day-map")).getByRole("button", { name: "Agregar actividad" })).toBeTruthy();
    expect(within(screen.getByTestId("day-map")).getByRole("button", { name: "¡Pregúntale a Tachi!" })).toBeTruthy();
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

  describe("itinerary modes", () => {
    const at = (date: string, time: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${date}T${time}:00`));
    };
    // d1 is 2026-10-26, d2 (the flight at 10:00 with its pass) is 2026-10-27.
    async function show(dayId: string, ownerId = "me", edit?: (activities: Activity[]) => Activity[]) {
      nav.pathname = "/trips/t";
      seed(ownerId);
      useItineraryStore.setState((s) => ({
        activeDayId: dayId,
        activeTrip: s.activeTrip && {
          ...s.activeTrip,
          days: s.activeTrip.days.map((d) => (d.id === "d1" && edit ? { ...d, activities: edit(d.activities) } : d)),
        },
      }));
      renderWithI18n(<TripView />);
      await act(async () => {});
    }
    const museumDay = (activities: Activity[]) => [
      { ...activities[0], title: "Museum", durationMin: 90, location: "Louvre" },
      makeActivity("a3", { title: "Lunch", time: "13:00" }),
    ];

    afterEach(() => vi.useRealTimers());

    it("shows what is on now and next above the timeline on today's day", async () => {
      at("2026-10-26", "10:30");
      await show("d1", "me", museumDay);
      const card = screen.getByRole("region", { name: "Ahora y siguiente" });
      expect(card.textContent).toContain("Ahora");
      expect(card.textContent).toContain("Museum");
      expect(card.textContent).toContain("Siguiente");
      expect(card.textContent).toContain("Lunch");
      const mapLink = within(card).getByRole("link", { name: "Abrir «Louvre» en Maps" });
      expect(mapLink.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=Louvre");
      const timeline = document.querySelector('[data-tour="timeline"]') as HTMLElement;
      expect(card.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("tapping the card scrolls to the activity", async () => {
      at("2026-10-26", "10:30");
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      await show("d1", "me", museumDay);
      const card = screen.getByRole("region", { name: "Ahora y siguiente" });
      fireEvent.click(within(card).getByRole("button", { name: "Ver «Lunch» en el día" }));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("activity-a3"));
    });

    it("opens the next activity's pass in one tap, for invitees too", async () => {
      at("2026-10-27", "08:00");
      await show("d2", "owner");
      const card = screen.getByRole("region", { name: "Ahora y siguiente" });
      fireEvent.click(within(card).getByRole("button", { name: "Abrir el documento de «Flight home»" }));
      expect(screen.getByTestId("viewer").textContent).toBe("pass.pdf · Flight home");
    });

    it("gives the card and banner controls 44 px touch targets", async () => {
      at("2026-10-27", "08:00");
      await show("d2", "owner");
      const card = screen.getByRole("region", { name: "Ahora y siguiente" });
      expect(within(card).getByRole("button", { name: "Abrir el documento de «Flight home»" }).className).toContain("size-11");
      for (const link of within(card).queryAllByRole("link")) expect(link.className).toContain("min-h-11");
      cleanup();
      at("2026-10-01", "10:00");
      await show("d1");
      const banner = screen.getByRole("region", { name: "Planificando" });
      expect(within(banner).getByRole("link").className).toContain("min-h-11");
    });

    it("hides the card when the day has nothing pending", async () => {
      at("2026-10-26", "20:00");
      await show("d1");
      expect(screen.queryByRole("region", { name: "Ahora y siguiente" })).toBeNull();
    });

    it("shows no card on a day other than today", async () => {
      at("2026-10-26", "08:00");
      await show("d2");
      expect(screen.queryByRole("region", { name: "Ahora y siguiente" })).toBeNull();
    });

    it("shows no banner on a day of a trip in progress", async () => {
      at("2026-10-26", "10:30");
      await show("d1");
      expect(screen.queryByRole("region", { name: "Planificando" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Viaje terminado" })).toBeNull();
    });

    it("before the trip, a planning banner links to the preparation in Trip › Summary", async () => {
      at("2026-10-20", "10:00");
      await show("d1");
      const banner = screen.getByRole("region", { name: "Planificando" });
      expect(banner.textContent).toContain("Faltan 6 días");
      expect(within(banner).getByRole("link", { name: "Ver preparación" }).getAttribute("href")).toBe("/trips/t/overview");
      expect(screen.queryByRole("region", { name: "Ahora y siguiente" })).toBeNull();
    });

    it("after the trip, a memory banner counts what was crossed off and links to My trips, without locking editing", async () => {
      at("2026-11-05", "10:00");
      await show("d1", "me", (activities) => [{ ...activities[0], state: "completed" }, makeActivity("a3")]);
      const banner = screen.getByRole("region", { name: "Viaje terminado" });
      expect(banner.textContent).toContain("Tachaste 1 de 3 actividades");
      expect(within(banner).getByRole("link", { name: "Planificar el siguiente" }).getAttribute("href")).toBe("/trips");
      expect(screen.getByRole("button", { name: "Agregar actividad" })).toBeTruthy();
    });

    it("a template draft, whose dates are the template's own, shows no trip mode banner", async () => {
      at("2026-11-05", "10:00");
      nav.pathname = "/trips/t";
      seed("me");
      useItineraryStore.setState({ activeDayId: "d1", activeTripIsDraft: true });
      renderWithI18n(<TripView />);
      await act(async () => {});
      expect(screen.queryByRole("region", { name: "Viaje terminado" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Planificando" })).toBeNull();
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
