// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";
import type { ShoppingItem, TripPlan } from "@/lib/types";

const auth = vi.hoisted(() => ({ session: { access_token: "fake-token" } as { access_token: string } | null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: auth.session } }),
    },
  },
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { ShoppingListPanel } = await import("@/components/ShoppingListPanel");

const item = (id: string, name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id, name, category: "food", notes: null, preferred_cities: null, preferred_country: null, priority: "medium", status: "pending", ...extra,
});

const trip = (shoppingItems: ShoppingItem[]): TripPlan => ({
  id: "t", name: "La Palma", criticalReservations: [], shoppingItems, ignoredShoppingSuggestionKeys: [], days: [],
});

const shoppingItems = () => useItineraryStore.getState().activeTrip!.shoppingItems;
const setItems = (items: ShoppingItem[]) => useItineraryStore.setState({ activeTrip: { ...useItineraryStore.getState().activeTrip!, shoppingItems: items } });

const addShoppingItems = vi.fn(async (items: ShoppingItem[]) => setItems([...shoppingItems(), ...items]));
const toggleShoppingItemStatus = vi.fn(async (id: string) =>
  setItems(shoppingItems().map((i) => (i.id === id ? { ...i, status: i.status === "purchased" ? "pending" as const : "purchased" as const } : i))));
const updateShoppingItem = vi.fn(async (id: string, patch: Partial<ShoppingItem>) => setItems(shoppingItems().map((i) => (i.id === id ? { ...i, ...patch } : i))));
const removeShoppingItem = vi.fn(async (id: string) => setItems(shoppingItems().filter((i) => i.id !== id)));

const fetchMock = vi.fn();
const onToast = vi.fn();
const onBought = vi.fn();
const onNearbyPlaces = vi.fn();
const onSelectItem = vi.fn();

const render = () =>
  renderWithI18n(
    <ShoppingListPanel today="2026-10-28" selectedItemId={null} onSelectItem={onSelectItem} onToast={onToast} onBought={onBought} onNearbyPlaces={onNearbyPlaces} />,
  );

const parsed = {
  ui: { input_mode: "textbox", input_placeholder: "", list_style: "todo", show_suggestions_card: false },
  suggestions: [],
  source: "ai",
  wishlist_items: [
    item("", "Mojo picón", { shopCategories: ["commercial.supermarket"] }),
    item("", "Recuerdo para la abuela", { category: "souvenir", shopCategories: ["commercial.gift_and_souvenir"] }),
    item("", "Decoración de mesa", { category: "other" }),
  ],
};

beforeEach(() => {
  auth.session = { access_token: "fake-token" };
  for (const mock of [addShoppingItems, toggleShoppingItemStatus, updateShoppingItem, removeShoppingItem, fetchMock, onToast, onBought, onNearbyPlaces, onSelectItem]) mock.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/shopping-assistant") return new Response(JSON.stringify(parsed));
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  useItineraryStore.setState({ activeTrip: trip([]), addShoppingItems, toggleShoppingItemStatus, updateShoppingItem, removeShoppingItem });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

/** Stands in for the browser's speech recognition; start/stop fire its own events. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
}

const assistantBody = () => JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/shopping-assistant")![1].body as string);

describe("ShoppingListPanel", () => {
  it("adds each thing at once, then refines names and categories with the AI, never showing OTHER", async () => {
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    render();
    fireEvent.change(screen.getByRole("textbox", { name: /Qué quieres comprar/ }), { target: { value: "comprar mojo picon, recuerdo para la abuela y decoracion mesa" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    // Visible before the AI answers.
    expect(await screen.findByText("Decoracion mesa")).toBeTruthy();
    expect(shoppingItems().map((i) => i.name)).toEqual(["Mojo picon", "Recuerdo para la abuela", "Decoracion mesa"]);
    const ids = shoppingItems().map((i) => i.id);
    expect(onToast).toHaveBeenCalledWith("Agregado: Mojo picon, Recuerdo para la abuela, Decoracion mesa");
    expect((screen.getByRole("textbox", { name: /Qué quieres comprar/ }) as HTMLInputElement).value).toBe("");
    expect(assistantBody()).toMatchObject({ type: "wishlist_input", text: "comprar mojo picon, recuerdo para la abuela y decoracion mesa", lang: "es", shopping_list: [] });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer fake-token" });

    await act(async () => answer(new Response(JSON.stringify(parsed))));
    expect(await screen.findByText("Decoración de mesa")).toBeTruthy();
    expect(shoppingItems().map((i) => [i.id, i.name, i.category, i.shopCategories])).toEqual([
      [ids[0], "Mojo picón", "food", ["commercial.supermarket"]],
      [ids[1], "Recuerdo para la abuela", "souvenir", ["commercial.gift_and_souvenir"]],
      [ids[2], "Decoración de mesa", "other", undefined],
    ]);
    expect(screen.getByText("Comida")).toBeTruthy();
    expect(screen.getByText("Recuerdo")).toBeTruthy();
    expect(screen.queryByText(/other/i)).toBeNull();
    expect(screen.queryByText("Otro")).toBeNull();
  });

  it("replaces a dictated run-on item when the AI splits it", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...parsed, wishlist_items: parsed.wishlist_items.slice(0, 2) })));
    render();
    fireEvent.change(screen.getByRole("textbox", { name: /Qué quieres comprar/ }), { target: { value: "mojo picon recuerdo para la abuela" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await waitFor(() => expect(shoppingItems().map((i) => i.name)).toEqual(["Mojo picón", "Recuerdo para la abuela"]));
    expect(new Set(shoppingItems().map((i) => i.id)).size).toBe(2);
  });

  it("keeps what the traveler changed before the AI answered", async () => {
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    render();
    fireEvent.change(screen.getByRole("textbox", { name: /Qué quieres comprar/ }), { target: { value: "comprar mojo picon, recuerdo para la abuela y decoracion mesa" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Mojo picon" }));
    await waitFor(() => expect(shoppingItems()[0].status).toBe("purchased"));

    await act(async () => answer(new Response(JSON.stringify(parsed))));
    await waitFor(() => expect(shoppingItems()[1].name).toBe("Recuerdo para la abuela"));
    await waitFor(() => expect(shoppingItems()[2].name).toBe("Decoración de mesa"));
    expect(shoppingItems()[0]).toMatchObject({ name: "Mojo picon", status: "purchased" });
  });

  it("does not ask the AI for guests", async () => {
    auth.session = null;
    render();
    fireEvent.change(screen.getByRole("textbox", { name: /Qué quieres comprar/ }), { target: { value: "imanes" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(await screen.findByText("Imanes")).toBeTruthy();
    expect(screen.getByText("Recuerdo")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dictates by voice like the timeline sync: listens, shows a countdown, then adds", async () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render();

    fireEvent.click(screen.getByRole("button", { name: "Dictar por voz" }));
    act(() => FakeRecognition.last!.onresult?.({ results: [[{ transcript: "mojo picón recuerdo para la abuela" }]] }));
    expect((screen.getByRole("textbox", { name: /Qué quieres comprar/ }) as HTMLInputElement).value).toBe("mojo picón recuerdo para la abuela");
    expect(screen.getByRole("button", { name: "Dejar de escuchar" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText("Agregando en 2s")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    for (let second = 0; second < 4; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(assistantBody().text).toBe("mojo picón recuerdo para la abuela");
  });

  it("does not add dictated text on its own once the traveler edits it", async () => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render();
    fireEvent.click(screen.getByRole("button", { name: "Dictar por voz" }));
    act(() => FakeRecognition.last!.onresult?.({ results: [[{ transcript: "mojo" }]] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Qué quieres comprar/ }), { target: { value: "mojo verde" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Agregando en/)).toBeNull();
  });

  it("edits a name inside the list, without a browser prompt", async () => {
    const prompt = vi.spyOn(window, "prompt");
    useItineraryStore.setState({ activeTrip: trip([item("s1", "Mojo pico")]) });
    render();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Mojo pico»" }));
    const field = screen.getByRole("textbox", { name: "Editar artículo de compras" });
    fireEvent.change(field, { target: { value: "Mojo picón" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(updateShoppingItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Mojo pico»" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Editar artículo de compras" }), { target: { value: "Mojo picón" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(updateShoppingItem).toHaveBeenCalledWith("s1", { name: "Mojo picón" }));
    expect(await screen.findByText("Mojo picón")).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("celebrates only when an item is checked as bought", async () => {
    useItineraryStore.setState({ activeTrip: trip([item("s1", "Mojo picón")]) });
    render();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mojo picón" }));
    await waitFor(() => expect(onBought).toHaveBeenCalledWith("Mojo picón"));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Mojo picón" }) as HTMLInputElement).checked).toBe(true));

    fireEvent.click(screen.getByRole("checkbox", { name: "Mojo picón" }));
    await waitFor(() => expect(toggleShoppingItemStatus).toHaveBeenCalledTimes(2));
    expect(onBought).toHaveBeenCalledTimes(1);
  });

  it("with my location, finds nearby shops per item, warns when one is close and follows the traveler", async () => {
    useItineraryStore.setState({
      activeTrip: trip([
        item("mojo", "Mojo picón", { shopCategories: ["commercial.marketplace"] }),
        item("abuela", "Recuerdo para la abuela", { category: "souvenir", shopCategories: ["commercial.gift_and_souvenir"] }),
      ]),
    });
    const mercado = { name: "Mercado de Santa Cruz", area: "Santa Cruz", address: null, lat: 28.6841, lon: -17.7648, categories: ["commercial.marketplace"] };
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ places: [mercado], attribution: "Powered by Geoapify / OpenStreetMap" })));
    let watcher: (pos: GeolocationPosition) => void = () => undefined;
    const at = (lat: number, lon: number) => ({ coords: { latitude: lat, longitude: lon } }) as GeolocationPosition;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) => ok(at(28.6835, -17.7642)),
        watchPosition: (ok: PositionCallback) => {
          watcher = ok;
          return 7;
        },
        clearWatch: vi.fn(),
      },
    });
    render();

    fireEvent.click(screen.getByRole("button", { name: /Usar mi ubicación/ }));
    expect(await screen.findByText("Mercado de Santa Cruz · 90 m")).toBeTruthy();
    expect(screen.getByText("Estás a 90 m de Mercado de Santa Cruz: ahí podrías comprar «Mojo picón».")).toBeTruthy();
    expect(onNearbyPlaces).toHaveBeenCalledWith([{ name: "Mercado de Santa Cruz", area: "Santa Cruz" }]);
    expect(onToast).toHaveBeenCalledWith("Te avisaremos si pasas cerca de una tienda para tu lista (con la app abierta).");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => watcher(at(28.6837, -17.7642)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => watcher(at(28.6900, -17.7642)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    // The same shop is not announced twice the same day.
    expect(screen.getAllByText(/ahí podrías comprar «Mojo picón»/)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByText(/ahí podrías comprar/)).toBeNull();
  });
});

describe("ShoppingListPanel nearby feedback", () => {
  const at = (lat: number, lon: number) => ({ coords: { latitude: lat, longitude: lon } }) as GeolocationPosition;
  beforeEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok(at(28.6835, -17.7642)), watchPosition: () => 3, clearWatch: vi.fn() },
    });
    useItineraryStore.setState({ activeTrip: trip([item("mojo", "Mojo picón", { shopCategories: ["commercial.marketplace"] })]) });
  });

  it("says when no shop nearby fits the list", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ places: [] })));
    render();
    fireEvent.click(screen.getByRole("button", { name: /Usar mi ubicación/ }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("No encontramos tiendas cerca para tu lista."));
  });

  it("says when the search failed", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render();
    fireEvent.click(screen.getByRole("button", { name: /Usar mi ubicación/ }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("No se pudieron cargar los lugares cercanos.", "error"));
  });

  it("drops the notice once the item is bought", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      places: [{ name: "Mercado de Santa Cruz", area: null, address: null, lat: 28.6841, lon: -17.7648, categories: ["commercial.marketplace"] }],
    })));
    render();
    fireEvent.click(screen.getByRole("button", { name: /Usar mi ubicación/ }));
    expect(await screen.findByText(/ahí podrías comprar «Mojo picón»/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mojo picón" }));
    await waitFor(() => expect(screen.queryByText(/ahí podrías comprar/)).toBeNull());
  });
});
