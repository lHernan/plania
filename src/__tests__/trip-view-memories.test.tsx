// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { Activity, Memory, TripPlan } from "@/lib/types";

const nav = vi.hoisted(() => ({ pathname: "/trips/t", push: vi.fn() }));
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
      getSession: async () => ({ data: { session: null } }),
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
const { TripMemoriesStory } = await import("@/components/memories/TripMemoriesStory");
const { clearTripMembersCache } = await import("@/components/memories/use-trip-members");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const memory = (id: string, overrides: Partial<Memory> = {}): Memory => ({
  id,
  tripId: "t",
  activityId: null,
  authorId: "me",
  note: `Note ${id}`,
  rating: null,
  audience: "trip",
  audienceUserIds: [],
  photos: [],
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...overrides,
});

const loadTripMembers = vi.fn(async () => ({ members: [{ userId: "me", email: "me@x.io", isOwner: true }] }));
const updateActivityState = vi.fn(async () => true);

// d1 is 2026-10-26 with a1 completed and a3 pending; d2 is 2026-10-27 with b1 pending.
function seed(memories: Memory[] = [], editD1?: (activities: Activity[]) => Activity[]) {
  const d1Activities = [makeActivity("a1", { title: "Museum", state: "completed" }), makeActivity("a3", { title: "Lunch", time: "13:00" })];
  const d1 = makeDay("d1", editD1 ? editD1(d1Activities) : d1Activities);
  const d2 = { ...makeDay("d2", [makeActivity("b1", { title: "Temple" })]), date: "2026-10-27" };
  const trip: TripPlan = { ...makeTrip([d1, d2]), id: "t", userId: "me", memories };
  useItineraryStore.setState({
    activeTrip: trip,
    activeDayId: "d1",
    activeTripIsDraft: false,
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
    loadTripMembers,
    updateActivityState,
  } as never);
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "me@x.io" } } as never);
}

async function show(pathname: string, date: string, memories: Memory[] = [], editD1?: (activities: Activity[]) => Activity[]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T10:00:00`));
  nav.pathname = pathname;
  seed(memories, editD1);
  renderWithI18n(<TripView />);
  await act(async () => {});
}

const timeline = () => document.querySelector('[data-tour="timeline"]') as HTMLElement;
const card = (id: string) => document.getElementById(`activity-${id}`) as HTMLElement;

beforeEach(() => {
  mockMatchMedia();
  clearTripMembersCache();
  loadTripMembers.mockClear();
  updateActivityState.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("memories in the itinerary", () => {
  it("in Recuerdo mode, completed activities show their memories and 'Añadir recuerdo'; pending ones do not", async () => {
    await show("/trips/t", "2026-11-05", [memory("m1", { activityId: "a1" }), memory("m2", { activityId: "a3" })]);
    const memories = screen.getByRole("region", { name: "Recuerdos de «Museum»" });
    expect(within(memories).getByText("Note m1")).toBeTruthy();
    expect(within(memories).getAllByRole("button", { name: "Añadir recuerdo" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Añadir recuerdo" })).toHaveLength(1);
    expect(screen.queryByText("Note m2")).toBeNull();
    expect(card("a3")).toBeTruthy();
  });

  it("'Añadir recuerdo' opens the editor for that activity", async () => {
    await show("/trips/t", "2026-11-05");
    fireEvent.click(screen.getByRole("button", { name: "Añadir recuerdo" }));
    expect(screen.getByRole("dialog", { name: "Nuevo recuerdo" })).toBeTruthy();
  });

  it("in Today mode, ticking an activity offers 'Añadir recuerdo' without blocking", async () => {
    await show("/trips/t", "2026-10-26", [], (activities) => activities.map((a) => ({ ...a, state: "pending" as const })));
    expect(screen.queryByRole("button", { name: "Añadir recuerdo" })).toBeNull();
    // The store would mark it completed; reflect that once the write is answered.
    updateActivityState.mockImplementationOnce(async () => {
      useItineraryStore.setState((s) => ({
        activeTrip: s.activeTrip && {
          ...s.activeTrip,
          days: s.activeTrip.days.map((d) => ({ ...d, activities: d.activities.map((a) => (a.id === "a1" ? { ...a, state: "completed" as const } : a)) })),
        },
      }));
      return true;
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar «Museum» como hecha" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Añadir recuerdo" })).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Nuevo recuerdo" })).toBeNull();
    expect(within(timeline()).getByText("Lunch")).toBeTruthy();
  });

  it("in Today mode, ticking another activity keeps an open memory editor and its draft", async () => {
    await show("/trips/t", "2026-10-26", [], (activities) => activities.map((a) => ({ ...a, state: "pending" as const })));
    const markCompleted = (id: string) => async () => {
      useItineraryStore.setState((s) => ({
        activeTrip: s.activeTrip && {
          ...s.activeTrip,
          days: s.activeTrip.days.map((d) => ({ ...d, activities: d.activities.map((a) => (a.id === id ? { ...a, state: "completed" as const } : a)) })),
        },
      }));
      return true;
    };
    updateActivityState.mockImplementationOnce(markCompleted("a1"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar «Museum» como hecha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Añadir recuerdo" }));
    const editor = screen.getByRole("dialog", { name: "Nuevo recuerdo" });
    fireEvent.change(within(editor).getByRole("textbox"), { target: { value: "Draft about the museum" } });

    // The editor is modal, but the keyboard can still reach the checkboxes behind it.
    updateActivityState.mockImplementationOnce(markCompleted("a3"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar «Lunch» como hecha" }));
    await waitFor(() => expect(updateActivityState).toHaveBeenCalledTimes(2));
    await act(async () => {});

    const still = screen.getByRole("dialog", { name: "Nuevo recuerdo" });
    expect((within(still).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft about the museum");
    expect(screen.getByRole("region", { name: "Recuerdos de «Museum»" })).toBeTruthy();
  });

  it("in Today mode, closing the editor of an activity without memories stops offering it once another one is ticked", async () => {
    await show("/trips/t", "2026-10-26", [], (activities) => activities.map((a) => ({ ...a, state: "pending" as const })));
    const markCompleted = (id: string) => async () => {
      useItineraryStore.setState((s) => ({
        activeTrip: s.activeTrip && {
          ...s.activeTrip,
          days: s.activeTrip.days.map((d) => ({ ...d, activities: d.activities.map((a) => (a.id === id ? { ...a, state: "completed" as const } : a)) })),
        },
      }));
      return true;
    };
    updateActivityState.mockImplementationOnce(markCompleted("a1"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar «Museum» como hecha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Añadir recuerdo" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Nuevo recuerdo" })).toBeNull();

    updateActivityState.mockImplementationOnce(markCompleted("a3"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marcar «Lunch» como hecha" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Recuerdos de «Lunch»" })).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Recuerdos de «Museum»" })).toBeNull();
  });

  it("a trip in planning mode renders the itinerary and the overview without any memories UI", async () => {
    await show("/trips/t", "2026-10-01", [memory("m1", { activityId: "a1" })]);
    expect(within(timeline()).getByText("Museum")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Añadir recuerdo" })).toBeNull();
    expect(screen.queryByText("Note m1")).toBeNull();
    // Members load once for the itinerary person filter (trip-expenses S4), not for memories.
    expect(loadTripMembers).toHaveBeenCalledTimes(1);
    cleanup();
    await show("/trips/t/overview", "2026-10-01", [memory("m1", { activityId: "a1" })]);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Resumen", "Maleta", "Compras", "Herramientas"]);
  });
});

describe("Recuerdos tab in Viaje", () => {
  it("appears only once the trip has ended", async () => {
    await show("/trips/t/overview", "2026-10-26");
    expect(within(screen.getByRole("tablist")).queryByRole("tab", { name: "Recuerdos" })).toBeNull();
    cleanup();
    await show("/trips/t/overview", "2026-11-05");
    expect(within(screen.getByRole("tablist")).getByRole("tab", { name: "Recuerdos" })).toBeTruthy();
  });

  it("tells the story by day with trip-level memories first and links to the map of what was crossed off", async () => {
    await show("/trips/t/overview", "2026-11-05", [memory("m1", { activityId: "a1" }), memory("trip1")]);
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("tab", { name: "Recuerdos" }));
    const panel = screen.getByRole("tabpanel");
    const text = panel.textContent ?? "";
    expect(text.indexOf("Note trip1")).toBeLessThan(text.indexOf("Museum"));
    expect(within(panel).getByRole("button", { name: "Añadir recuerdo del viaje" })).toBeTruthy();
    const headings = within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    // "Del viaje", then only d1 (d2 has nothing crossed off nor remembered).
    expect(headings).toHaveLength(2);
    expect(headings[0]).toBe("Del viaje");
    expect(headings[1]).toContain("26");
    expect(within(panel).getByText("Note m1")).toBeTruthy();
    expect(within(panel).queryByText("Lunch")).toBeNull();
    expect(within(panel).queryByText("Temple")).toBeNull();
    expect(within(panel).getByRole("link", { name: "Ver en el mapa lo que tachaste" }).getAttribute("href")).toBe("/trips/t/map");
  });
});

describe("TripMemoriesStory", () => {
  it("names the days of an undated trip by number", async () => {
    const d1 = makeDay("d1", [makeActivity("a1")]);
    const d2 = makeDay("d2", [makeActivity("b1", { title: "Temple", state: "completed" })]);
    const trip: TripPlan = { ...makeTrip([d1, d2]), travelContext: { undated: true } as never, memories: [] };
    useItineraryStore.setState({ loadTripMembers } as never);
    renderWithI18n(<TripMemoriesStory trip={trip} currentUserId="me" mapHref="/trips/t/map" />);
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Del viaje", "Día 2"]);
  });
});
