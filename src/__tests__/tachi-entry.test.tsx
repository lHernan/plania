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

// Leaves that fetch on mount or load heavy tooling; stubs show where they are opened.
vi.mock("@/components/CriticalReservationsPanel", () => ({ CriticalReservationsPanel: () => <section data-testid="reservations" /> }));
vi.mock("@/components/ShoppingListPanel", () => ({ ShoppingListPanel: () => <section data-testid="shopping" /> }));
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => null }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => null }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => null }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => <section data-testid="packing" /> }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/DayGeniusModal", () => ({
  DayGeniusModal: ({ dayId }: { dayId: string }) => <div data-testid="day-genius">{dayId}</div>,
}));
vi.mock("@/components/BookingImportModal", () => ({ BookingImportModal: () => <div data-testid="booking-import" /> }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useChatStore } = await import("@/store/use-chat-store");

const ASK = "¡Pregúntale a Tachi!";
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));

type Who = "owner" | "invitee" | "guest";

function seed(who: Who) {
  const day = makeDay("d1", [makeActivity("a1", { title: "Senso-ji" })]);
  const second = { ...makeDay("d2", []), date: "2026-10-27", city: "Kyoto" };
  const trip = { ...makeTrip([day, second]), id: "t", userId: who === "invitee" ? "owner" : "me" };
  useItineraryStore.setState({
    activeTrip: trip,
    activeDayId: "d1",
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
  } as never);
  useAuthStore.setState({
    user: who === "guest" ? { id: "me", is_anonymous: true } : { id: "me", is_anonymous: false, email: "me@x.io" },
  } as never);
}

async function renderAt(pathname: string, who: Who = "owner") {
  nav.pathname = pathname;
  seed(who);
  renderWithI18n(<TripView />);
  await act(async () => {});
}

async function openTachi() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: ASK }));
  });
  return screen.getByRole("complementary", { name: "Tachi" });
}

const actionNames = (sheet: HTMLElement) =>
  within(within(sheet).getByRole("group", { name: "Acciones sugeridas" })).getAllByRole("button").map((b) => b.textContent?.trim());

beforeEach(() => {
  mockMatchMedia();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.setState({ isOpen: false, messages: [], loadedTripId: null, loadingHistory: false, sending: false, error: null, draft: "" });
  map.props = null;
  useItineraryStore.setState({ activeTripIsDraft: false } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Tachi, the single AI entry point", () => {
  it("is one button on every section, and the old agent button and AI quick actions are gone", async () => {
    for (const path of ["/trips/t", "/trips/t/wallet", "/trips/t/overview"]) {
      await renderAt(path);
      expect(screen.getAllByRole("button", { name: ASK })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /agente/i })).toBeNull();
      expect(document.querySelector('[data-tour="ai-shortcuts"]')).toBeNull();
      expect(screen.queryByText("Acciones rápidas con IA")).toBeNull();
      cleanup();
    }
    await renderAt("/trips/t/map");
    expect(within(screen.getByTestId("day-map")).getAllByRole("button", { name: ASK })).toHaveLength(1);
  });

  it("is visible to a guest and opens the sign-in sheet without calling the AI", async () => {
    await renderAt("/trips/t", "guest");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ASK }));
    });
    expect(screen.getByText("Bienvenido de nuevo")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Tachi" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/"))).toEqual([]);
  });

  it("tells a guest the sign-in is for Tachi", async () => {
    await renderAt("/trips/t", "guest");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ASK }));
    });
    expect(screen.getByText("Tachi es para usuarios registrados. Inicia sesión y seguiremos donde lo dejaste.")).toBeTruthy();
  });

  it("tells a guest saving a draft that the sign-in keeps it", async () => {
    await renderAt("/trips/t", "guest");
    useItineraryStore.setState({ activeTripIsDraft: true } as never);
    await act(async () => {});
    const banner = screen.getByText("Este viaje es un borrador y solo está en este dispositivo. Inicia sesión para guardarlo.").parentElement!;
    await act(async () => {
      fireEvent.click(within(banner).getByRole("button", { name: "Guardar" }));
    });
    expect(screen.getByText("Guarda tu borrador")).toBeTruthy();
  });

  it("opens with the active day in its header", async () => {
    await renderAt("/trips/t");
    const sheet = await openTachi();
    expect(within(sheet).getByText("Tokyo · lunes 26")).toBeTruthy();
  });

  it("offers the itinerary actions on the itinerary, three first and the rest on demand", async () => {
    await renderAt("/trips/t");
    const sheet = await openTachi();
    expect(actionNames(sheet)).toEqual(["Reorganizar el día", "Rellenar huecos", "Importar notas"]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Más acciones" }));
    expect(actionNames(sheet)).toEqual(["Reorganizar el día", "Rellenar huecos", "Importar notas", "Importar reservas"]);
    expect(within(sheet).queryByRole("button", { name: "Más acciones" })).toBeNull();
  });

  it("offers the wallet actions on the wallet", async () => {
    await renderAt("/trips/t/wallet");
    const names = actionNames(await openTachi());
    expect(names).toContain("Importar PDF");
    expect(names).not.toContain("Reorganizar el día");
  });

  it("offers the packing list on the trip overview and goes to its tab", async () => {
    await renderAt("/trips/t/overview");
    const sheet = await openTachi();
    expect(actionNames(sheet)).toContain("Generar maleta");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Generar maleta" }));
    });
    expect(screen.getByRole("tab", { name: "Maleta" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("packing")).toBeTruthy();
  });

  it("rearranges the active day with the day planner", async () => {
    await renderAt("/trips/t");
    const sheet = await openTachi();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Reorganizar el día" }));
    });
    expect(screen.getByTestId("day-genius").textContent).toBe("d1");
  });

  it("imports bookings and PDFs with the booking import", async () => {
    await renderAt("/trips/t/wallet");
    const sheet = await openTachi();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Importar PDF" }));
    });
    expect(screen.getByTestId("booking-import")).toBeTruthy();
  });

  it("imports notes inside the sheet with the existing text import", async () => {
    await renderAt("/trips/t");
    const sheet = await openTachi();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Importar notas" }));
    });
    expect(within(sheet).getByRole("button", { name: "Sincronizar a la Linea de Tiempo" })).toBeTruthy();
  });

  it("keeps the conversation with the agent inside the sheet, with its history", async () => {
    await renderAt("/trips/t");
    const sheet = await openTachi();
    expect(within(sheet).getByPlaceholderText("Pregúntale a Tachi...")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/chat?tripId=t"))).toBe(true);
  });

  it("opens with the selected activity as context from the map", async () => {
    await renderAt("/trips/t/map");
    act(() => (map.props?.onActivitySelect as (id: string) => void)("a1"));
    const sheet = await openTachi();
    expect(within(sheet).getByText("Senso-ji")).toBeTruthy();
    expect(actionNames(sheet)).toContain("Cómo llegar");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Cómo llegar" }));
    });
    expect((within(sheet).getByRole("textbox") as HTMLTextAreaElement).value).toBe("¿Cómo llego a «Senso-ji»?");
  });

  it("gives an invitee no write actions", async () => {
    await renderAt("/trips/t", "invitee");
    const names = actionNames(await openTachi());
    expect(names).not.toContain("Reorganizar el día");
    expect(names).not.toContain("Importar notas");
    expect(names).not.toContain("Importar reservas");
  });
});

// S3 (odd/tasks/growth-quick-wins.md): the trip view tells Tachi whether the user may apply proposals.
describe("Tachi proposals in the trip view", () => {
  const proposal = {
    id: "m1",
    tripId: "t",
    userId: "me",
    role: "assistant" as const,
    content: "Te propongo esto",
    actions: [{ type: "update_activity_state" as const, payload: { dayId: "d1", activityId: "a1", state: "completed" as const } }],
    createdAt: "2026-11-06T10:00:00Z",
  };

  async function openWithProposal(who: Who) {
    await renderAt("/trips/t", who);
    useChatStore.setState({ messages: [proposal], proposals: { m1: "pending" }, loadedTripId: "t" });
    return openTachi();
  }

  it("lets the owner apply or dismiss them", async () => {
    const sheet = await openWithProposal("owner");
    expect(within(sheet).getByRole("button", { name: "Aplicar" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Descartar" })).toBeTruthy();
  });

  it("keeps a viewer's Tachi read-only", async () => {
    const sheet = await openWithProposal("invitee");
    expect(within(sheet).getByText("Te propongo esto")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Aplicar" })).toBeNull();
  });
});
