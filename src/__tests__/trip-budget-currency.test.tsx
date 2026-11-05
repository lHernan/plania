// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { Activity, TravelContext } from "@/lib/types";

const nav = vi.hoisted(() => ({ pathname: "/trips/t/overview" }));
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
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView, ActivityEditModal } = await import("@/components/TripView");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const saveTravelContext = vi.fn(async () => ({}));
/** Intl separates the amount and the symbol with a no-break space. */
const plain = (value: string | null | undefined) => (value ?? "").replace(/\s/g, " ");

function seed({ context, ownerId = "me", activities }: { context?: TravelContext; ownerId?: string; activities?: Activity[] } = {}) {
  const day = makeDay("d1", activities ?? [makeActivity("a1", { expectedCost: 40 }), makeActivity("a2", { expectedCost: 30 })]);
  const trip = { ...makeTrip([day]), id: "t", userId: ownerId, ...(context ? { travelContext: context } : {}) };
  useItineraryStore.setState({
    activeTrip: trip,
    activeDayId: "d1",
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
    saveTravelContext,
  } as never);
}

async function renderAt(pathname: string) {
  nav.pathname = pathname;
  renderWithI18n(<TripView />);
  await act(async () => {});
}

const budgetCard = () => screen.getByText("Presupuesto").closest("div.rounded-2xl") as HTMLElement;

beforeEach(() => {
  mockMatchMedia();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  saveTravelContext.mockClear();
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "me@x.io", user_metadata: {} } } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("trip budget currency", () => {
  it("formats the budget card in the trip currency for the current locale", async () => {
    seed({ context: { version: 1, currency: "EUR" } });
    await renderAt("/trips/t/overview");
    expect(plain(budgetCard().textContent)).toContain("70,00 € est.");
    expect(plain(budgetCard().textContent)).toContain("2026-10-26: 70,00 €");
  });

  it("formats the day total in the trip currency", async () => {
    seed({ context: { version: 1, currency: "EUR" } });
    await renderAt("/trips/t");
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && plain(el.textContent) === "70,00 €")).toBeTruthy();
  });

  it("falls back to the preferred currency for a trip saved without one", async () => {
    window.localStorage.setItem("plania_home_currency", "GBP");
    seed({ context: { version: 1, travelerCount: 2 } });
    await renderAt("/trips/t/overview");
    expect(plain(budgetCard().textContent)).toContain("70,00 GBP est.");
    expect(saveTravelContext).not.toHaveBeenCalled();
  });

  it("lets the owner change the trip currency, kept in the travel context", async () => {
    seed({ context: { version: 1, travelerCount: 2 } });
    await renderAt("/trips/t/overview");
    const select = within(budgetCard()).getByRole("combobox", { name: "Moneda del viaje" }) as HTMLSelectElement;
    expect(select.value).toBe("USD");
    fireEvent.change(select, { target: { value: "HUF" } });
    expect(saveTravelContext).toHaveBeenCalledWith({ version: 1, travelerCount: 2, currency: "HUF" });
  });

  it("shows the currency to a viewer without letting them change it", async () => {
    seed({ context: { version: 1, currency: "EUR" }, ownerId: "owner" });
    await renderAt("/trips/t/overview");
    expect(within(budgetCard()).queryByRole("combobox")).toBeNull();
    expect(plain(budgetCard().textContent)).toContain("70,00 €");
  });
});

describe("estimated vs actual", () => {
  it("shows the actual total next to the estimate once an actual cost exists", async () => {
    seed({
      context: { version: 1, currency: "EUR" },
      activities: [makeActivity("a1", { expectedCost: 40, actualCost: 45 }), makeActivity("a2", { expectedCost: 30 })],
    });
    await renderAt("/trips/t/overview");
    const text = plain(budgetCard().textContent);
    expect(text).toContain("Estimado70,00 €");
    expect(text).toContain("Real45,00 €");
  });

  it("leaves the actual total out while no actual cost was entered", async () => {
    seed({ context: { version: 1, currency: "EUR" } });
    await renderAt("/trips/t/overview");
    expect(within(budgetCard()).queryByText("Real")).toBeNull();
  });

  it("edits the actual cost next to the expected cost, sending it only when set", () => {
    const onSave = vi.fn();
    const props = { onClose: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onPreviewFile: vi.fn(), onSave, currency: "EUR" };
    renderWithI18n(<ActivityEditModal activity={makeActivity("a1", { expectedCost: 40 })} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("actualCost");
    cleanup();

    renderWithI18n(<ActivityEditModal activity={makeActivity("a1", { expectedCost: 40 })} {...props} />);
    expect(screen.getAllByText("€").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Costo real"), { target: { value: "52.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));
    expect(onSave.mock.calls[1][0]).toMatchObject({ expectedCost: 40, actualCost: 52.5 });
  });
});
