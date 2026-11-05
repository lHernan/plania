// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";
import type { PackingRecord, TripPlan } from "@/lib/types";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
  },
}));

const { PackingListCard } = await import("@/components/PackingListCard");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useItineraryStore } = await import("@/store/use-itinerary-store");

const TRIP = "t1";
const ME = "me";
const days = [{ id: "d1", date: "2026-11-15", city: "Madrid", label: "1", activities: [], userId: ME }];

const record = (id: string, name: string, extra: Partial<PackingRecord> = {}): PackingRecord => ({
  id, name, quantity: 1, reason: "", status: "pending", scope: "shared", category: "Salud", ownerId: null, assignedTo: null, sortOrder: 0, ...extra,
});

const ITEMS = [record("p1", "Abrigo", { scope: "personal", ownerId: ME, category: "Ropa" }), record("s1", "Botiquín")];

const actions = {
  addPackingItem: vi.fn(async () => {}),
  togglePackingItem: vi.fn(async () => {}),
  assignPackingItem: vi.fn(async () => {}),
  removePackingItem: vi.fn(async () => {}),
  replacePackingList: vi.fn(async () => {}),
};

function setTrip(role: "owner" | "editor" | "viewer", items = ITEMS, ownerId = ME) {
  const trip: TripPlan = {
    id: TRIP, name: "Madrid", userId: ownerId, days, criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [],
    packing: { items, remote: true, role },
  };
  useItineraryStore.setState({ activeTrip: trip, activeTripIsDraft: false, sharedTrips: [], ...actions });
}

const fetchMock = vi.fn(async (url: string) => {
  if (url === `/api/trips/${TRIP}/shares`) {
    return new Response(JSON.stringify({ shares: [{ userId: "ana", email: "ana@example.com", role: "editor", createdAt: "" }] }), { status: 200 });
  }
  if (url.startsWith("/api/weather")) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify({ categories: [{ name: "Documentos", items: [{ id: "x", name: "Seguro", quantity: 1, reason: "Viaje", status: "pending" }] }] }), { status: 200 });
});

const card = () => renderWithI18n(<PackingListCard tripId={TRIP} tripName="Madrid" days={days} defaultOpen />);

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockClear();
  Object.values(actions).forEach((action) => action.mockClear());
  vi.stubGlobal("fetch", fetchMock);
  useAuthStore.setState({ user: { id: ME, is_anonymous: false } as never });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useItineraryStore.setState({ activeTrip: null });
});

describe("PackingListCard modes", () => {
  it("switches between my packing and the shared list and remembers the choice per trip", () => {
    setTrip("owner");
    card();
    expect(screen.getByRole("button", { name: "Mi maleta" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Abrigo")).toBeTruthy();
    expect(screen.queryByText("Botiquín")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Compartida" }));
    expect(screen.getByText("Botiquín")).toBeTruthy();
    expect(screen.queryByText("Abrigo")).toBeNull();
    cleanup();

    card();
    expect(screen.getByRole("button", { name: "Compartida" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Botiquín")).toBeTruthy();
  });

  it("writes toggles and manual items into the selected list", () => {
    setTrip("owner");
    card();
    fireEvent.click(screen.getByRole("button", { name: "Compartida" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Botiquín" }));
    expect(actions.togglePackingItem).toHaveBeenCalledWith("s1");
    fireEvent.change(screen.getByPlaceholderText("Agregar un artículo…"), { target: { value: "Tiritas" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(actions.addPackingItem).toHaveBeenCalledWith("shared", "Tiritas");
  });

  it("offers only the people of the trip as who brings each shared item and saves the choice", async () => {
    setTrip("owner");
    card();
    fireEvent.click(screen.getByRole("button", { name: "Compartida" }));
    const select = (await screen.findByRole("combobox", { name: "Quién lo lleva: Botiquín" })) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sin asignar", "Yo", "ana@example.com"]));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === `/api/trips/${TRIP}/shares`) as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    fireEvent.change(select, { target: { value: "ana" } });
    expect(actions.assignPackingItem).toHaveBeenCalledWith("s1", "ana");
    fireEvent.change(select, { target: { value: "" } });
    expect(actions.assignPackingItem).toHaveBeenLastCalledWith("s1", null);
  });

  it("lists the trip owner and me for an editor, who cannot read the share list", () => {
    setTrip("editor", ITEMS, "owner-id");
    card();
    fireEvent.click(screen.getByRole("button", { name: "Compartida" }));
    const select = screen.getByRole("combobox", { name: "Quién lo lleva: Botiquín" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sin asignar", "Yo", "Dueño del viaje"]);
    expect(fetchMock.mock.calls.some(([url]) => url === `/api/trips/${TRIP}/shares`)).toBe(false);
  });

  it("shows the shared list read-only to a viewer, whose own list stays editable", () => {
    setTrip("viewer", [...ITEMS, record("s2", "Mapa", { assignedTo: ME })], "owner-id");
    card();
    fireEvent.click(screen.getByRole("button", { name: "Compartida" }));
    expect(screen.getByText("Botiquín")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Botiquín" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByPlaceholderText("Agregar un artículo…")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Regenerar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar Botiquín" })).toBeNull();
    expect(screen.getByText("Quién lo lleva: Yo")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Botiquín" }));
    expect(actions.togglePackingItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mi maleta" }));
    expect(screen.getByPlaceholderText("Agregar un artículo…")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Abrigo" }));
    expect(actions.togglePackingItem).toHaveBeenCalledWith("p1");
  });

  it("generates into the selected list", async () => {
    setTrip("owner", [record("p1", "Abrigo", { scope: "personal", ownerId: ME, category: "Ropa" })]);
    card();
    fireEvent.click(screen.getByRole("button", { name: "Compartida" }));
    fireEvent.click(screen.getByRole("button", { name: "Generar lista de equipaje" }));
    await waitFor(() => expect(actions.replacePackingList).toHaveBeenCalledTimes(1));
    const [scope, list] = actions.replacePackingList.mock.calls[0] as unknown as [string, { tripId: string; categories: { name: string }[] }];
    expect(scope).toBe("shared");
    expect(list.tripId).toBe(TRIP);
    expect(list.categories.map((c) => c.name)).toEqual(["Documentos"]);
  });

  it("does not offer generation of the shared list to a viewer", () => {
    setTrip("viewer", [], "owner-id");
    card();
    fireEvent.click(screen.getByRole("button", { name: "Compartida" }));
    expect(screen.queryByRole("button", { name: "Generar lista de equipaje" })).toBeNull();
  });
});

describe("PackingListCard without the server list (sample trip, guest, pending migration)", () => {
  it("keeps the personal list on this device: generate, toggle and add into the first category", async () => {
    useItineraryStore.setState({ activeTrip: null });
    card();
    expect(screen.queryByRole("button", { name: "Compartida" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generar lista de equipaje" }));
    await screen.findByText("Seguro");
    const stored = () => JSON.parse(window.localStorage.getItem(`plania_packing_${TRIP}`)!);
    expect(stored().categories[0].items.map((i: { name: string }) => i.name)).toEqual(["Seguro"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Seguro" }));
    expect(stored().categories[0].items[0].status).toBe("packed");

    fireEvent.change(screen.getByPlaceholderText("Agregar un artículo…"), { target: { value: "Tiritas" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(stored().categories[0].items.map((i: { name: string }) => i.name)).toEqual(["Seguro", "Tiritas"]);
    expect(actions.replacePackingList).not.toHaveBeenCalled();
  });
});
