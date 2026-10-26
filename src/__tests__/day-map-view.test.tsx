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
  Polyline: () => null,
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
