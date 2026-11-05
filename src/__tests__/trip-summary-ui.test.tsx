// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { TripPlan } from "@/lib/types";

// S4: "Resume mi viaje" from Tachi and from the Recuerdos tab, registered users only.
const nav = vi.hoisted(() => ({ pathname: "/trips/t/overview", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="day-map" /> }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no" } }) }) },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
  },
}));
vi.mock("@/components/CriticalReservationsPanel", () => ({ CriticalReservationsPanel: () => <section data-testid="reservations" /> }));
vi.mock("@/components/ShoppingListPanel", () => ({ ShoppingListPanel: () => <section data-testid="shopping" /> }));
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => null }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => null }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => null }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => <section data-testid="packing" /> }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { clearTripMembersCache } = await import("@/components/memories/use-trip-members");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useChatStore } = await import("@/store/use-chat-store");

const ASK = "¡Pregúntale a Tachi!";
const SUMMARIZE = "Resume mi viaje";
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const summaryCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/summary"));

// The trip runs 2026-10-26..27: on 2026-11-05 it has ended (Recuerdo mode), on 2026-10-01 it is being planned.
async function show(date: string, who: "registered" | "guest" = "registered") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T10:00:00`));
  const d1 = makeDay("d1", [makeActivity("a1", { title: "Museum", state: "completed" })]);
  const d2 = { ...makeDay("d2", []), date: "2026-10-27" };
  const trip: TripPlan = { ...makeTrip([d1, d2]), id: "t", userId: "me", memories: [] };
  useItineraryStore.setState({
    activeTrip: trip,
    activeDayId: "d1",
    activeTripIsDraft: false,
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
    loadTripMembers: vi.fn(async () => ({ members: [] })),
  } as never);
  useAuthStore.setState({
    user: who === "guest" ? { id: "me", is_anonymous: true } : { id: "me", is_anonymous: false, email: "me@x.io" },
  } as never);
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

async function openSummaryFromTachi() {
  const sheet = await openTachi();
  await act(async () => {
    fireEvent.click(within(sheet).getByRole("button", { name: SUMMARIZE }));
  });
  return sheet;
}

const setOnline = (online: boolean) => Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });

beforeEach(() => {
  mockMatchMedia();
  clearTripMembersCache();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  setOnline(true);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) =>
    String(url).includes("/summary")
      ? new Response(JSON.stringify({ summary: `Resumen ${summaryCalls().length}` }), { status: 200 })
      : new Response(JSON.stringify({ messages: [] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.setState({ isOpen: false, messages: [], loadedTripId: null, loadingHistory: false, sending: false, error: null, draft: "" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Tachi: Resume mi viaje", () => {
  it("keeps the overview actions of a trip being planned unchanged, without the summary", async () => {
    await show("2026-10-01");
    expect(actionNames(await openTachi())).toEqual(["Generar maleta", "Revisar preparación"]);
  });

  it("is offered on the overview once the trip has ended, next to the existing actions", async () => {
    await show("2026-11-05");
    expect(actionNames(await openTachi())).toEqual([SUMMARIZE, "Generar maleta", "Revisar preparación"]);
  });

  it("is never offered to guests: Tachi asks them to sign in", async () => {
    await show("2026-11-05", "guest");
    fireEvent.click(screen.getByRole("button", { name: ASK }));
    expect(screen.queryByRole("complementary", { name: "Tachi" })).toBeNull();
    expect(screen.queryByRole("button", { name: SUMMARIZE })).toBeNull();
  });

  it("asks the summary route with the session and shows the result with copy and regenerate", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    await show("2026-11-05");
    const sheet = await openSummaryFromTachi();
    await waitFor(() => expect(within(sheet).getByText("Resumen 1")).toBeTruthy());
    const [url, init] = summaryCalls()[0];
    expect(url).toBe("/api/trips/t/summary");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toEqual({ lang: "es" });

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Copiar" }));
    });
    expect(writeText).toHaveBeenCalledWith("Resumen 1");
    expect(within(sheet).getByText("Copiado")).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Volver a generar" }));
    });
    await waitFor(() => expect(within(sheet).getByText("Resumen 2")).toBeTruthy());
    expect(summaryCalls()).toHaveLength(2);
  });

  it("says it is offline instead of calling the route", async () => {
    await show("2026-11-05");
    setOnline(false);
    const sheet = await openSummaryFromTachi();
    await waitFor(() => expect(within(sheet).getByText(/Sin conexión/)).toBeTruthy());
    expect(summaryCalls()).toHaveLength(0);
  });

  it("shows an error when the route fails, and can try again", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("/summary") ? new Response(JSON.stringify({ error: "ai_unavailable" }), { status: 503 }) : new Response("{}", { status: 200 }),
    );
    await show("2026-11-05");
    const sheet = await openSummaryFromTachi();
    await waitFor(() => expect(within(sheet).getByRole("alert").textContent).toContain("Tachi no pudo resumir tu viaje"));
    expect(within(sheet).getByRole("button", { name: "Volver a generar" })).toBeTruthy();
  });
});

describe("Recuerdos tab: Resume mi viaje con Tachi", () => {
  it("opens Tachi on the trip summary", async () => {
    await show("2026-11-05");
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: "Recuerdos" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume mi viaje con Tachi" }));
    });
    const sheet = screen.getByRole("complementary", { name: "Tachi" });
    expect(within(sheet).getByRole("heading", { name: SUMMARIZE })).toBeTruthy();
    await waitFor(() => expect(within(sheet).getByText("Resumen 1")).toBeTruthy());
  });

  it("is not shown to guests", async () => {
    await show("2026-11-05", "guest");
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: "Recuerdos" }));
    expect(screen.queryByRole("button", { name: "Resume mi viaje con Tachi" })).toBeNull();
  });
});
