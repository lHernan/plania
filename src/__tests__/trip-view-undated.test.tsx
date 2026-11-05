// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { TravelContext } from "@/lib/types";

const nav = vi.hoisted(() => ({ pathname: "/trips/t", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
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
// Leaves that talk to the network or the browser; not what this test is about.
vi.mock("@/components/CriticalReservationsPanel", () => ({ CriticalReservationsPanel: () => null }));
vi.mock("@/components/ShoppingListPanel", () => ({ ShoppingListPanel: () => null }));
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => null }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => null }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => null }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => null }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const setTripDates = vi.fn<(start: string) => Promise<{ error?: string }>>(async () => ({}));
const UNDATED: TravelContext = { version: 1, undated: true };

async function renderTrip(pathname: string, { travelContext = UNDATED as TravelContext | null, ownerId = "me" } = {}) {
  nav.pathname = pathname;
  // Placeholder dates: the first one is today.
  const days = [
    { ...makeDay("d1", [makeActivity("a1", { time: "09:00", durationMin: 600 })]), date: "2026-11-05", city: "Lisboa" },
    { ...makeDay("d2", []), date: "2026-11-06", city: "Lisboa" },
  ];
  const trip = { ...makeTrip(days), id: "t", name: "Lisboa", userId: ownerId, ...(travelContext ? { travelContext } : {}) };
  useItineraryStore.setState({
    activeTrip: trip,
    activeTripIsDraft: false,
    activeDayId: "d1",
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
    setTripDates,
  } as never);
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "me@x.io" } } as never);
  renderWithI18n(<TripView />);
  await act(async () => {});
}

const dayStrip = () => document.querySelector('[data-tour="day-strip"]') as HTMLElement;
const timeline = () => document.querySelector('[data-tour="timeline"]') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00"));
  mockMatchMedia();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  setTripDates.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TripView of an undated trip", () => {
  it("shows \"Día N\" in the day strip and the day headers, with no dates", async () => {
    await renderTrip("/trips/t");
    const tabs = within(dayStrip()).getAllByRole("button").filter((b) => b.textContent?.startsWith("Día") && b.textContent !== "Día");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Día1", "Día2"]);
    expect(dayStrip().textContent).not.toMatch(/jue|vie/);
    expect(within(timeline()).getByRole("heading", { level: 2 }).textContent).toBe("Día 1");
    expect(document.body.textContent).not.toMatch(/jue|nov 5/);
  });

  it("is never live: the planning banner without dates, no now/next and no jump to today", async () => {
    await renderTrip("/trips/t");
    expect(screen.getByText("Sin fechas")).toBeTruthy();
    expect(screen.queryByLabelText("Ahora y siguiente")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hoy" })).toBeNull();
  });

  it("keeps the dated labels and today mode for a dated trip with the same days", async () => {
    await renderTrip("/trips/t", { travelContext: null });
    expect(dayStrip().textContent).toMatch(/jue/);
    expect(within(timeline()).getByRole("heading", { level: 2 }).textContent).toBe("jueves, nov 5");
    expect(screen.queryByText("Sin fechas")).toBeNull();
    expect(screen.getByLabelText("Ahora y siguiente")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hoy" })).toBeTruthy();
  });

  it("lets the owner set the dates from the overview: start chosen, end derived", async () => {
    await renderTrip("/trips/t/overview");
    expect(screen.getByText("2 días, sin fechas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fijar fechas" }));
    const dialog = screen.getByRole("dialog", { name: "Fijar las fechas del viaje" });
    fireEvent.change(within(dialog).getByLabelText("Fecha de inicio"), { target: { value: "2027-03-30" } });
    const end = within(dialog).getByLabelText("Fecha de fin") as HTMLInputElement;
    expect(end.value).toBe("2027-03-31");
    expect(end.readOnly).toBe(true);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Guardar fechas" }));
    });
    expect(setTripDates).toHaveBeenCalledWith("2027-03-30");
    expect(screen.queryByRole("dialog", { name: "Fijar las fechas del viaje" })).toBeNull();
  });

  it("shows only the label to someone the trip is shared with", async () => {
    await renderTrip("/trips/t/overview", { ownerId: "owner" });
    expect(screen.getByText("2 días, sin fechas")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fijar fechas" })).toBeNull();
  });
});
