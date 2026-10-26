// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeActivity, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import DayMapView from "@/components/DayMapView";
import { I18nProvider } from "@/components/I18nProvider";
import type { Activity } from "@/lib/types";

const coordsByLocation: Record<string, { lat: number; lng: number }> = {
  "Senso-ji": { lat: 35.7148, lng: 139.7967 },
  "Ueno Park": { lat: 35.7156, lng: 139.7745 },
  "Shibuya <Crossing>": { lat: 35.6595, lng: 139.7005 },
};

const stableMap = {
  getContainer: () => document.createElement("div"),
  stop: vi.fn(),
  setView: vi.fn(),
  fitBounds: vi.fn(),
  getZoom: () => 13,
};

// Leaflet needs a real layout engine; render markers as plain buttons instead.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  ZoomControl: () => null,
  Polyline: ({ positions, pathOptions }: { positions: [number, number][]; pathOptions: { dashArray?: string } }) => (
    <i data-testid="route-leg" data-style={pathOptions.dashArray ? "dashed" : "solid"} data-positions={JSON.stringify(positions)} />
  ),
  Popup: () => null,
  Marker: ({ title, icon, eventHandlers }: { title?: string; icon: { html: string }; eventHandlers?: { click?: () => void } }) =>
    title ? (
      <button data-testid="marker" data-icon={icon.html} onClick={() => eventHandlers?.click?.()}>
        {title}
      </button>
    ) : null,
  useMap: () => stableMap,
  useMapEvents: () => null,
}));
vi.mock("leaflet", () => ({ default: { divIcon: (options: unknown) => options } }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("@/hooks/use-geocode-cache", () => ({
  useGeocodeCache: () => ({
    getCoords: (location: string) => coordsByLocation[location] ?? null,
    geocodeActivities: vi.fn(),
    isLoading: false,
  }),
}));

function renderMap(activities: Activity[], overrides: Partial<Parameters<typeof DayMapView>[0]> = {}) {
  const props = {
    dayId: "d1",
    activities,
    city: "Tokyo",
    activeActivityId: null,
    onActivitySelect: vi.fn(),
    onToggleComplete: vi.fn(),
    onOpenDetails: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = renderWithI18n(<DayMapView {...props} />);
  return { ...view, props };
}

const markerTitles = () => screen.queryAllByTestId("marker").map((m) => m.textContent);

const mixedDay = () => [
  makeActivity("a", { title: "Temple", location: "Senso-ji", time: "09:00" }),
  makeActivity("b", { title: "Park", location: "Ueno Park", time: "11:00", state: "completed" }),
  makeActivity("c", { title: "No place yet", time: "13:00" }),
];

beforeEach(() => mockMatchMedia());
afterEach(cleanup);

describe("DayMapView markers", () => {
  it("keeps completed activities on the map next to pending ones", () => {
    renderMap(mixedDay());
    expect(markerTitles()).toEqual(["1. Temple — Pendiente", "2. Park — Tachada ✓"]);
  });

  it("marks completed markers with a check instead of their number", () => {
    renderMap(mixedDay());
    const [pending, completed] = screen.getAllByTestId("marker");
    expect(pending.dataset.icon).toContain(">1</span>");
    expect(completed.dataset.icon).toContain("✓");
    expect(completed.dataset.icon).not.toContain(">2</span>");
  });

  it("keeps the marker number stable when an activity gets completed", () => {
    const { rerender, props } = renderMap(mixedDay());
    const updated = mixedDay().map((a) => (a.id === "a" ? { ...a, state: "completed" as const } : a));
    rerender(
      <I18nProvider>
        <DayMapView {...props} activities={updated} />
      </I18nProvider>
    );
    expect(markerTitles()).toEqual(["1. Temple — Tachada ✓", "2. Park — Tachada ✓"]);
  });

  it("escapes activity titles inside the marker HTML", () => {
    renderMap([makeActivity("x", { title: "<img src=x onerror=alert(1)>", location: "Shibuya <Crossing>" })]);
    const html = screen.getByTestId("marker").dataset.icon ?? "";
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("leaves activities without coordinates out of the map", () => {
    renderMap(mixedDay());
    expect(markerTitles().some((t) => t?.includes("No place yet"))).toBe(false);
  });

  it("explains the empty map when no activity has coordinates", () => {
    renderMap([makeActivity("c", { title: "No place yet" })]);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText("Tus actividades siguen disponibles en la lista.")).toBeTruthy();
  });
});

describe("DayMapView filters", () => {
  it("defaults to all and shows counts per status", () => {
    renderMap(mixedDay());
    const all = screen.getByRole("button", { name: /Todas/ });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(all.textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Pendientes/ }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: /Tachadas ✓/ }).textContent).toContain("1");
  });

  it("shows only pending markers with the pending filter", () => {
    renderMap(mixedDay());
    fireEvent.click(screen.getByRole("button", { name: /Pendientes/ }));
    expect(markerTitles()).toEqual(["1. Temple — Pendiente"]);
  });

  it("shows only completed markers with the completed filter", () => {
    renderMap(mixedDay());
    fireEvent.click(screen.getByRole("button", { name: /Tachadas ✓/ }));
    expect(markerTitles()).toEqual(["2. Park — Tachada ✓"]);
  });

  it("never changes activity data when filtering", () => {
    const activities = mixedDay();
    const snapshot = JSON.stringify(activities);
    const { props } = renderMap(activities);
    fireEvent.click(screen.getByRole("button", { name: /Pendientes/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tachadas ✓/ }));
    fireEvent.click(screen.getByRole("button", { name: /Todas/ }));
    expect(JSON.stringify(activities)).toBe(snapshot);
    expect(props.onToggleComplete).not.toHaveBeenCalled();
  });
});

describe("DayMapView completed day", () => {
  const doneDay = () => [
    makeActivity("a", { title: "Temple", location: "Senso-ji", state: "completed" }),
    makeActivity("b", { title: "Park", location: "Ueno Park", state: "completed" }),
  ];

  it("keeps every marker and shows the memories note instead of an empty state", () => {
    renderMap(doneDay());
    expect(screen.getAllByTestId("marker")).toHaveLength(2);
    expect(screen.getByText("¡Día tachao! 🎉")).toBeTruthy();
    expect(screen.getByText("Hoy has convertido estos lugares en recuerdos.")).toBeTruthy();
  });

  it("shows a filter-specific message for pending without hiding the map", () => {
    renderMap(doneDay());
    fireEvent.click(screen.getByRole("button", { name: /Pendientes/ }));
    expect(screen.getByText("¡Todo tachao por hoy! No quedan actividades pendientes.")).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Todas/ }));
    expect(screen.getAllByTestId("marker")).toHaveLength(2);
  });
});

describe("DayMapView selected marker card", () => {
  it("selects an activity when its marker is clicked", () => {
    const { props } = renderMap(mixedDay());
    fireEvent.click(screen.getAllByTestId("marker")[0]);
    expect(props.onActivitySelect).toHaveBeenCalledWith("a");
  });

  it("completes a pending activity from the card", () => {
    const { props } = renderMap(mixedDay(), { activeActivityId: "a" });
    const card = screen.getByRole("dialog", { name: "Temple" });
    expect(card.textContent).toContain("09:00");
    expect(card.textContent).toContain("Senso-ji");
    fireEvent.click(screen.getByRole("button", { name: "Tachar" }));
    expect(props.onToggleComplete).toHaveBeenCalledWith("a", true);
  });

  it("returns a completed activity to pending from the card", () => {
    const { props } = renderMap(mixedDay(), { activeActivityId: "b" });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como pendiente" }));
    expect(props.onToggleComplete).toHaveBeenCalledWith("b", false);
  });

  it("opens details and closes the card", () => {
    const { props } = renderMap(mixedDay(), { activeActivityId: "a" });
    fireEvent.click(screen.getByRole("button", { name: /Ver detalles/ }));
    expect(props.onOpenDetails).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(props.onActivitySelect).toHaveBeenCalledWith(null);
  });

  it("hides the toggle for read-only viewers", () => {
    renderMap(mixedDay(), { activeActivityId: "a", canEdit: false });
    expect(screen.queryByRole("button", { name: "Tachar" })).toBeNull();
  });

  it("hides the card when the filter hides the selected activity", () => {
    renderMap(mixedDay(), { activeActivityId: "a" });
    fireEvent.click(screen.getByRole("button", { name: /Tachadas ✓/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const variedDay = () => [
  makeActivity("a", { title: "Temple", location: "Senso-ji", time: "09:00", category: "sightseeing" }),
  makeActivity("b", { title: "Ramen lunch", location: "Ueno Park", time: "12:00", category: "food", state: "completed" }),
  makeActivity("c", { title: "Café Crossing", location: "Shibuya <Crossing>", time: "15:00", category: "food" }),
  makeActivity("d", { title: "Museum café", time: "17:00", category: "food" }),
];

const openSearch = () => fireEvent.click(screen.getByRole("button", { name: "Buscar actividades" }));
const typeSearch = (value: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar actividades" }), { target: { value } });

describe("DayMapView search", () => {
  it("filters markers by activity name, ignoring accents", () => {
    renderMap(variedDay());
    openSearch();
    typeSearch("cafe crossing");
    expect(markerTitles()).toEqual(["3. Café Crossing — Pendiente"]);
  });

  it("finds activities by location", () => {
    renderMap(variedDay());
    openSearch();
    typeSearch("ueno");
    expect(markerTitles()).toEqual(["2. Ramen lunch — Tachada ✓"]);
  });

  it("centers on a result by selecting it", () => {
    const { props } = renderMap(variedDay());
    openSearch();
    typeSearch("temple");
    fireEvent.click(screen.getByRole("button", { name: /^Temple/ }));
    expect(props.onActivitySelect).toHaveBeenCalledWith("a");
  });

  it("lists matches without coordinates without making them selectable", () => {
    renderMap(variedDay());
    openSearch();
    typeSearch("museum");
    const result = screen.getByRole("button", { name: /Museum café/ });
    expect(result.textContent).toContain("Sin ubicación en el mapa");
    expect((result as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains when nothing matches and keeps the map", () => {
    renderMap(variedDay());
    openSearch();
    typeSearch("zzz");
    expect(screen.getByText("Ninguna actividad coincide con «zzz».")).toBeTruthy();
    expect(screen.getByText("Ningún lugar coincide con estos filtros.")).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
  });

  it("restores every marker when the search is cleared", () => {
    renderMap(variedDay());
    openSearch();
    typeSearch("temple");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(screen.getAllByTestId("marker")).toHaveLength(3);
  });
});

describe("DayMapView categories", () => {
  const openCategories = () => fireEvent.click(screen.getByRole("button", { name: "Categorías" }));
  const chips = () =>
    Array.from(screen.getByRole("group", { name: "Categorías" }).querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));

  it("offers only the categories present in the day", () => {
    renderMap(variedDay());
    openCategories();
    expect(chips()).toHaveLength(2);
  });

  it("hides the category control when the day has a single category", () => {
    renderMap(mixedDay());
    expect(screen.queryByRole("button", { name: "Categorías" })).toBeNull();
  });

  it("filters by one or several categories", () => {
    renderMap(variedDay());
    openCategories();
    fireEvent.click(chips()[1]); // food
    expect(markerTitles()).toEqual(["2. Ramen lunch — Tachada ✓", "3. Café Crossing — Pendiente"]);
    fireEvent.click(chips()[0]); // + sightseeing
    expect(markerTitles()).toHaveLength(3);
  });

  it("combines categories with the status filter and scopes the counts", () => {
    renderMap(variedDay());
    openCategories();
    fireEvent.click(chips()[1]); // food
    expect(screen.getByRole("button", { name: /Pendientes/ }).textContent).toContain("1");
    fireEvent.click(screen.getByRole("button", { name: /Pendientes/ }));
    expect(markerTitles()).toEqual(["3. Café Crossing — Pendiente"]);
  });

  it("clears every filter in one action without touching data", () => {
    const activities = variedDay();
    const snapshot = JSON.stringify(activities);
    const { props } = renderMap(activities);
    openCategories();
    fireEvent.click(chips()[1]);
    fireEvent.click(screen.getByRole("button", { name: /Pendientes/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);
    expect(screen.getAllByTestId("marker")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Todas/ }).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.stringify(activities)).toBe(snapshot);
    expect(props.onToggleComplete).not.toHaveBeenCalled();
  });

  it("resets categories and search when the day changes", () => {
    const { rerender, props } = renderMap(variedDay());
    openSearch();
    typeSearch("temple");
    rerender(
      <I18nProvider>
        <DayMapView {...props} dayId="d2" />
      </I18nProvider>
    );
    expect(screen.getAllByTestId("marker")).toHaveLength(3);
  });
});

describe("DayMapView visit order line", () => {
  const legs = () => screen.queryAllByTestId("route-leg");

  it("connects mapped stops in itinerary order", () => {
    renderMap(variedDay());
    expect(legs().map((l) => JSON.parse(l.dataset.positions!))).toEqual([
      [[35.7148, 139.7967], [35.7156, 139.7745]],
      [[35.7156, 139.7745], [35.6595, 139.7005]],
    ]);
  });

  it("draws done legs solid and pending legs dashed", () => {
    renderMap([
      makeActivity("a", { location: "Senso-ji", time: "09:00", state: "completed" }),
      makeActivity("b", { location: "Ueno Park", time: "10:00", state: "completed" }),
      makeActivity("c", { location: "Shibuya <Crossing>", time: "11:00" }),
    ]);
    expect(legs().map((l) => l.dataset.style)).toEqual(["solid", "dashed"]);
  });

  it("labels the line as straight segments, not a street route", () => {
    renderMap(variedDay());
    expect(screen.getByText("Orden de visita · líneas rectas, no es una ruta por calles")).toBeTruthy();
  });

  it("hides the line while filtering instead of joining only visible stops", () => {
    renderMap(variedDay());
    fireEvent.click(screen.getByRole("button", { name: /Pendientes/ }));
    expect(legs()).toHaveLength(0);
    expect(screen.getByText("Orden de visita oculto mientras filtras")).toBeTruthy();
  });

  it("can be turned off from its control", () => {
    renderMap(variedDay());
    fireEvent.click(screen.getByRole("button", { name: "Orden de visita" }));
    expect(legs()).toHaveLength(0);
  });

  it("is not drawn with a single mapped stop", () => {
    renderMap([makeActivity("a", { location: "Senso-ji" })]);
    expect(legs()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Orden de visita" })).toBeNull();
  });
});

describe("DayMapView directions", () => {
  const directions = () => new URL(screen.getByRole("link", { name: /Cómo llegar/ }).getAttribute("href")!);

  beforeEach(() => window.localStorage.removeItem("tachao_travel_mode"));

  it("opens Google Maps at the coordinates of the selected marker", () => {
    renderMap(variedDay(), { activeActivityId: "a" });
    expect(directions().searchParams.get("destination")).toBe("35.7148,139.7967");
    expect(directions().searchParams.get("travelmode")).toBe("walking");
  });

  it("lets the traveler pick another travel mode and remembers it", () => {
    renderMap(variedDay(), { activeActivityId: "a" });
    fireEvent.click(screen.getByRole("button", { name: "Transporte público" }));
    expect(directions().searchParams.get("travelmode")).toBe("transit");
    fireEvent.click(screen.getByRole("button", { name: "En coche" }));
    expect(directions().searchParams.get("travelmode")).toBe("driving");
    expect(window.localStorage.getItem("tachao_travel_mode")).toBe("driving");
  });

  it("defaults to public transport when the trip prefers less walking", () => {
    renderMap(variedDay(), { activeActivityId: "a", preferMinimizeWalking: true });
    expect(directions().searchParams.get("travelmode")).toBe("transit");
  });

  it("keeps the details and completion actions next to directions after the layout change", () => {
    renderMap(variedDay(), { activeActivityId: "a", floatingActions: <button>FAB</button> });
    expect(screen.getByRole("link", { name: /Cómo llegar/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "FAB" })).toBeTruthy();
  });

  it("keeps the details and completion actions next to directions", () => {
    renderMap(variedDay(), { activeActivityId: "a" });
    expect(screen.getByRole("button", { name: /Ver detalles/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tachar" })).toBeTruthy();
  });
});

describe("DayMapView bottom dock", () => {
  const fab = () => screen.getByRole("button", { name: "FAB" });
  const dockOf = (el: HTMLElement) => el.closest("[data-map-bottom-dock]") as HTMLElement | null;

  it("stacks floating actions above the selected activity card in one dock", () => {
    renderMap(variedDay(), { activeActivityId: "a", floatingActions: <button>FAB</button> });
    const card = screen.getByRole("dialog", { name: "Temple" });
    const dock = dockOf(card);
    expect(dock).not.toBeNull();
    expect(dockOf(fab())).toBe(dock);
    // Floating actions come first, so they sit above the card and move up as it grows.
    expect(fab().compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lets the card flow in the dock instead of positioning itself", () => {
    renderMap(variedDay(), { activeActivityId: "a" });
    expect(screen.getByRole("dialog", { name: "Temple" }).className).not.toMatch(/\babsolute\b|\bfixed\b/);
  });

  it("keeps the floating actions in the dock when no card is open", () => {
    renderMap(variedDay(), { floatingActions: <button>FAB</button> });
    expect(dockOf(fab())).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stacks floating actions above the day-complete note too", () => {
    renderMap(
      [
        makeActivity("a", { location: "Senso-ji", state: "completed" }),
        makeActivity("b", { location: "Ueno Park", state: "completed" }),
      ],
      { floatingActions: <button>FAB</button> }
    );
    const note = screen.getByRole("note");
    expect(dockOf(note)).toBe(dockOf(fab()));
    expect(fab().compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("respects the bottom safe area", () => {
    renderMap(variedDay(), { activeActivityId: "a" });
    expect(dockOf(screen.getByRole("dialog"))!.className).toContain("safe-area-inset-bottom");
  });
});
