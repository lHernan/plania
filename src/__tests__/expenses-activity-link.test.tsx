// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { TripMember, TripPlan } from "@/lib/types";

type DbError = { code?: string; message?: string } | null;
type Result = { data: unknown; error: DbError };

/** The fake database (results per table and rpc, a call log) and the fake router. */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  rpc: {} as Record<string, Result>,
  log: [] as unknown[][],
}));
const nav = vi.hoisted(() => ({ pathname: "/trips/t", search: "", push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="day-map" /> }));
vi.mock("@/lib/supabase", () => {
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "order", "insert", "delete", "update", "upsert"]) {
      q[op] = (...args: unknown[]) => (db.log.push([`${table}.${op}`, ...args]), q);
    }
    q.then = (resolve: (r: Result) => void) => resolve(db.tables[table] ?? { data: [], error: null });
    return q;
  };
  return {
    supabase: {
      from,
      rpc: async (fn: string, args: unknown) => (db.log.push(["rpc", fn, args]), db.rpc[fn] ?? { data: null, error: null }),
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          remove: async () => ({ error: null }),
          createSignedUrl: async () => ({ data: null, error: { message: "no" } }),
        }),
      },
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: null } }),
      },
    },
  };
});
vi.mock("@/components/CriticalReservationsPanel", () => ({ CriticalReservationsPanel: () => <section /> }));
vi.mock("@/components/ShoppingListPanel", () => ({ ShoppingListPanel: () => <section /> }));
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => null }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => null }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => null }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => <section /> }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { ExpensesView } = await import("@/components/expenses/ExpensesView");
const { clearTripMembersCache } = await import("@/components/memories/use-trip-members");
const { clearTripExpensesCache } = await import("@/hooks/use-trip-expenses");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useOfflineStore } = await import("@/store/use-offline-store");

const MEMBERS: TripMember[] = [
  { userId: "me", email: "hernan@x.io", isOwner: true, displayName: "Hernán L" },
  { userId: "maria", email: "maria@x.io", isOwner: false, displayName: "María" },
];

function expenseRow(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    trip_id: "t",
    activity_id: null,
    title: id,
    amount_cents: 0,
    currency: "EUR",
    spent_on: "2026-10-26",
    category: "other",
    paid_by: "me",
    split_method: "equal",
    notes: null,
    receipt_path: null,
    created_by: "me",
    created_at: "2026-10-26T10:00:00Z",
    updated_at: "2026-10-26T10:00:00Z",
    expense_splits: [
      { user_id: "me", share_cents: 0, percent_bp: null },
      { user_id: "maria", share_cents: 0, percent_bp: null },
    ],
    ...overrides,
  };
}

const flightExpense = expenseRow("e-flight", { title: "Billete Iberia", amount_cents: 12000, category: "flights", activity_id: "tfn", paid_by: "maria" });
const flightUsd = expenseRow("e-bag", { title: "Maleta", amount_cents: 3000, currency: "USD", activity_id: "tfn" });
const loose = expenseRow("e-loose", { title: "Café", amount_cents: 450 });

function setTrip() {
  const day = makeDay("d1", [
    makeActivity("walk", { title: "Paseo por Madrid", time: "18:00" }),
    makeActivity("tfn", {
      title: "Vuelo Tenerife – Madrid",
      time: "08:00",
      category: "transport",
      origin: "booking",
      booking: { version: 1, type: "flight", role: "single", groupId: "g", title: "Vuelo" } as never,
    }),
  ]);
  const trip: TripPlan = { ...makeTrip([day]), id: "t", userId: "me", memories: [] };
  useItineraryStore.setState({
    activeTrip: trip,
    activeDayId: "d1",
    activeTripIsDraft: false,
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
    loadTripMembers: vi.fn(async () => ({ members: MEMBERS })),
  } as never);
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "hernan@x.io" } } as never);
}

async function showTrip(expenses: unknown[]) {
  db.tables.expenses = { data: expenses, error: null };
  setTrip();
  renderWithI18n(<TripView />);
  await act(async () => {});
}

async function showExpenses(expenses: unknown[] = []) {
  db.tables.expenses = { data: expenses, error: null };
  setTrip();
  renderWithI18n(<ExpensesView tripId="t" ownerId="me" currency="EUR" />);
  await act(async () => {});
}

const norm = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim();
const rpcCalls = (fn: string) => db.log.filter((entry) => entry[0] === "rpc" && entry[1] === fn);
const savedExpense = () => (rpcCalls("save_expense")[0][2] as { p_expense: Record<string, unknown> }).p_expense;

beforeEach(() => {
  mockMatchMedia();
  clearTripMembersCache();
  clearTripExpensesCache();
  window.localStorage.clear();
  db.tables = {};
  db.rpc = { save_expense: { data: "new-id", error: null } };
  db.log = [];
  nav.pathname = "/trips/t";
  nav.search = "";
  nav.push.mockReset();
  useOfflineStore.setState({ isOnline: true } as never);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("linking an expense to an activity", () => {
  it("offers the trip's activities by day and saves the chosen one", async () => {
    await showExpenses();
    fireEvent.click(screen.getAllByRole("button", { name: "Añadir gasto" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    const select = within(dialog).getByLabelText("Actividad") as HTMLSelectElement;
    expect(select.value).toBe("");
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options).toEqual(["Ninguna", "08:00 · Vuelo Tenerife – Madrid", "18:00 · Paseo por Madrid"]);
    expect(select.querySelector("optgroup")?.getAttribute("label")).toMatch(/26/);

    fireEvent.change(within(dialog).getByLabelText("Concepto"), { target: { value: "Taxi al aeropuerto" } });
    fireEvent.change(within(dialog).getByLabelText("Importe"), { target: { value: "30" } });
    fireEvent.change(select, { target: { value: "tfn" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar gasto" }));
    await act(async () => {});
    expect(savedExpense()).toMatchObject({ title: "Taxi al aeropuerto", activity_id: "tfn" });
  });

  it("'Ninguna' saves an expense without an activity", async () => {
    await showExpenses();
    fireEvent.click(screen.getAllByRole("button", { name: "Añadir gasto" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    fireEvent.change(within(dialog).getByLabelText("Concepto"), { target: { value: "Café" } });
    fireEvent.change(within(dialog).getByLabelText("Importe"), { target: { value: "4,5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar gasto" }));
    await act(async () => {});
    expect(savedExpense().activity_id).toBeNull();
  });

  it("shows the linked activity on the expense row", async () => {
    await showExpenses([flightExpense, loose]);
    expect(screen.getByRole("button", { name: /Billete Iberia/ }).textContent).toContain("Vuelo Tenerife – Madrid");
    expect(screen.getByRole("button", { name: /Café/ }).textContent).not.toContain("Vuelo");
  });

  it("opens the editor prefilled for the activity from ?new=", async () => {
    nav.pathname = "/trips/t/expenses";
    nav.search = "new=tfn";
    await showExpenses();
    const dialog = screen.getByRole("dialog", { name: "Nuevo gasto" });
    expect((within(dialog).getByLabelText("Concepto") as HTMLInputElement).value).toBe("Vuelo Tenerife – Madrid");
    expect((within(dialog).getByLabelText("Actividad") as HTMLSelectElement).value).toBe("tfn");
    expect((within(dialog).getByRole("radio", { name: "Vuelos" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Importe"), { target: { value: "120" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar gasto" }));
    await act(async () => {});
    expect(savedExpense()).toMatchObject({ activity_id: "tfn", category: "flights", amount_cents: 12000 });
  });

  it("opens a linked expense from ?expense=", async () => {
    nav.pathname = "/trips/t/expenses";
    nav.search = "expense=e-flight";
    await showExpenses([flightExpense, loose]);
    const dialog = screen.getByRole("dialog", { name: "Editar gasto" });
    expect((within(dialog).getByLabelText("Concepto") as HTMLInputElement).value).toBe("Billete Iberia");
  });
});

describe("an activity shows what it cost", () => {
  it("shows the spent chip only on activities with linked expenses", async () => {
    await showTrip([flightExpense, flightUsd, loose]);
    const chip = within(document.getElementById("activity-tfn")!).getByTestId("activity-spent");
    expect(norm(chip)).toBe("120,00 € · 30,00 US$");
    expect(within(document.getElementById("activity-walk")!).queryByTestId("activity-spent")).toBeNull();
  });

  it("shows no chip when expenses cannot be loaded, and the itinerary still works", async () => {
    db.tables.expenses = { data: null, error: { code: "42P01", message: 'relation "expenses" does not exist' } };
    setTrip();
    renderWithI18n(<TripView />);
    await act(async () => {});
    expect(document.getElementById("activity-tfn")).not.toBeNull();
    expect(screen.queryByTestId("activity-spent")).toBeNull();
  });

  it("lists the linked expenses in the activity and adds one from there", async () => {
    await showTrip([flightExpense, loose]);
    fireEvent.click(within(document.getElementById("activity-tfn")!).getByText("Vuelo Tenerife – Madrid"));
    const block = screen.getByRole("region", { name: "Gastos de la actividad" });
    const items = within(block).getAllByRole("button", { name: /Billete Iberia/ });
    expect(items).toHaveLength(1);
    expect(norm(items[0])).toContain("120,00 €");
    expect(items[0].textContent).toContain("María");
    expect(block.textContent).not.toContain("Café");

    fireEvent.click(within(block).getByRole("button", { name: "Añadir gasto" }));
    expect(nav.push).toHaveBeenCalledWith("/trips/t/expenses?new=tfn");
  });

  it("opens a linked expense in the Gastos section", async () => {
    await showTrip([flightExpense]);
    fireEvent.click(within(document.getElementById("activity-tfn")!).getByText("Vuelo Tenerife – Madrid"));
    const block = screen.getByRole("region", { name: "Gastos de la actividad" });
    fireEvent.click(within(block).getByRole("button", { name: /Billete Iberia/ }));
    expect(nav.push).toHaveBeenCalledWith("/trips/t/expenses?expense=e-flight");
  });
});
