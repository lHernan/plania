// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";

// S2 on the client: a 429 "ai_quota_exceeded" shows one shared message; other errors keep theirs.
const nav = vi.hoisted(() => ({ pathname: "/trips/t" }));
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
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => null }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => null }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => null }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/DayGeniusModal", () => ({ DayGeniusModal: () => null }));
vi.mock("@/components/BookingImportModal", () => ({ BookingImportModal: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { isAiQuotaExceeded } = await import("@/lib/ai/quota-client");
const { ChatPanel } = await import("@/components/ChatPanel");
const { TripView } = await import("@/components/TripView");
const { useChatStore } = await import("@/store/use-chat-store");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { requestMemoryCaption } = await import("@/components/memories/memory-caption-client");
const { requestTripSummary } = await import("@/hooks/use-trip-summary");

const ES = "Has alcanzado el límite de uso de hoy. Inténtalo de nuevo mañana.";
const EN = "You've reached today's limit. Try again tomorrow.";

const quotaResponse = () =>
  new Response(JSON.stringify({ error: "ai_quota_exceeded", bucket: "chat", limit: 100 }), { status: 429, headers: { "Retry-After": "60" } });

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  mockMatchMedia();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  useChatStore.setState({ isOpen: false, messages: [], loadedTripId: null, loadingHistory: false, sending: false, error: null, draft: "" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("isAiQuotaExceeded", () => {
  it("is true only for a 429 with error ai_quota_exceeded, and leaves the body readable", async () => {
    const response = quotaResponse();
    expect(await isAiQuotaExceeded(response)).toBe(true);
    expect((await response.json()).error).toBe("ai_quota_exceeded");
  });

  it("is false for other 429s, other statuses and unreadable bodies", async () => {
    expect(await isAiQuotaExceeded(new Response(JSON.stringify({ error: "Please wait" }), { status: 429 }))).toBe(false);
    expect(await isAiQuotaExceeded(new Response(JSON.stringify({ error: "ai_quota_exceeded" }), { status: 500 }))).toBe(false);
    expect(await isAiQuotaExceeded(new Response("not json", { status: 429 }))).toBe(false);
  });
});

describe("chat shows the daily limit", () => {
  it.each([
    ["es", ES],
    ["en", EN],
  ] as const)("in %s", async (lang, message) => {
    fetchMock.mockImplementation(async (url) =>
      String(url) === "/api/chat" ? quotaResponse() : new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    useChatStore.setState({ loadedTripId: "trip-1" });
    renderWithI18n(<ChatPanel tripId="trip-1" />, lang);
    await act(async () => {
      await useChatStore.getState().sendMessage("trip-1", "hola", lang);
    });
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("keeps the short-term throttle message for its own 429", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url) === "/api/chat"
        ? new Response(JSON.stringify({ error: "Please wait before sending another travel chat message." }), { status: 429 })
        : new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    useChatStore.setState({ loadedTripId: "trip-1" });
    renderWithI18n(<ChatPanel tripId="trip-1" />, "es");
    await act(async () => {
      await useChatStore.getState().sendMessage("trip-1", "hola", "es");
    });
    expect(screen.getByText("Please wait before sending another travel chat message.")).toBeTruthy();
    expect(screen.queryByText(ES)).toBeNull();
  });
});

describe("notes import shows the daily limit", () => {
  it("toasts the limit message instead of the generic import error", async () => {
    nav.pathname = "/trips/t";
    useItineraryStore.setState({
      activeTrip: { ...makeTrip([makeDay("d1", [makeActivity("a1", { title: "Senso-ji" })])]), id: "t", userId: "me" },
      activeDayId: "d1",
      loading: false,
      error: null,
      hasFetched: true,
      activeTripIsDraft: false,
      fetchActiveTrip: vi.fn(async () => {}),
    } as never);
    useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "me@x.io" } } as never);
    fetchMock.mockImplementation(async (url) =>
      String(url) === "/api/import" ? quotaResponse() : new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithI18n(<TripView />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "¡Pregúntale a Tachi!" }));
    });
    const sheet = screen.getByRole("complementary", { name: "Tachi" });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Importar notas" }));
    });
    fireEvent.change(within(sheet).getByPlaceholderText(/^Pega tus notas/), { target: { value: "14:00 Almuerzo" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Sincronizar a la Linea de Tiempo" }));
    });

    expect(fetchMock.mock.calls.some(([url]) => url === "/api/import")).toBe(true);
    expect(screen.getByText(ES)).toBeTruthy();
    expect(screen.queryByText("Tachi tuvo un problema. Verifica tu conexión e inténtalo de nuevo.")).toBeNull();
  });
});

describe("summary and caption report the daily limit", () => {
  it("trip summary returns the quota status", async () => {
    fetchMock.mockImplementation(async () => quotaResponse());
    expect(await requestTripSummary("t1", "es")).toEqual({ status: "quota_exceeded", summary: "" });
  });

  it("memory caption returns the quota error", async () => {
    fetchMock.mockImplementation(async () => quotaResponse());
    expect(await requestMemoryCaption({ tripId: "t1", activityTitle: "Museo", lang: "es" })).toEqual({ error: "quota_exceeded" });
  });
});
