// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { SharedTripSummary, TripSummary } from "@/lib/types";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips",
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

const { MyTrips } = await import("@/components/MyTrips");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { TRIP_TEMPLATES } = await import("@/lib/trip-templates");

const summary = (id: string, name: string, dates?: [string, string], extra: Partial<TripSummary> = {}): TripSummary => ({
  id,
  name,
  startDate: dates?.[0],
  endDate: dates?.[1],
  dayCount: 3,
  activityCount: 7,
  ...extra,
});

const ownTrips = [
  summary("past", "Roma 2001", ["2001-01-01", "2001-01-05"]),
  summary("draft", "Islandia", undefined, { dayCount: 5, activityCount: 2 }),
  summary("next", "Lima", ["2998-03-01", "2998-03-04"]),
  summary("now", "Tokio", ["2000-01-01", "2999-12-31"], { isFavorite: true }),
];
const shared: SharedTripSummary[] = [
  { ...summary("sh", "Boda en Sevilla", ["2998-05-01", "2998-05-02"]), ownerEmail: "ana@x.io", ownerId: "ana" },
];

const actions = {
  fetchAllTrips: vi.fn(async () => {}),
  fetchSharedTrips: vi.fn(async () => {}),
  setTripFavorite: vi.fn<(id: string) => Promise<void>>(async () => {}),
  deleteTrip: vi.fn<(id: string) => Promise<void>>(async () => {}),
  createTrip: vi.fn<(name: string, start?: string, end?: string) => Promise<void>>(async () => {}),
  loadTemplate: vi.fn<(plan: unknown) => void>(() => {}),
};

function seed(trips: TripSummary[], sharedTrips: SharedTripSummary[] = []) {
  useItineraryStore.setState({
    trips,
    sharedTrips,
    activeTrip: null,
    activeTripIsDraft: false,
    hasFetched: true,
    loading: false,
    ...actions,
  });
}

beforeEach(() => {
  mockMatchMedia();
  nav.push.mockClear();
  Object.values(actions).forEach((fn) => fn.mockClear());
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ initialized: true, user: { id: "me", is_anonymous: false, email: "me@x.io" } as never });
  seed(ownTrips, shared);
});
afterEach(cleanup);

const groupTitles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const card = (name: string) => screen.getByRole("article", { name });

describe("MyTrips", () => {
  it("groups the trips in progress, upcoming, without dates, shared and past, in that order", () => {
    renderWithI18n(<MyTrips />);
    expect(groupTitles()).toEqual(["En curso", "Próximos", "En planificación", "Compartidos conmigo", "Anteriores"]);
    const groups = screen.getAllByRole("region");
    expect(within(groups[0]).getByText("Tokio")).toBeTruthy();
    expect(within(groups[1]).getByText("Lima")).toBeTruthy();
    expect(within(groups[2]).getByText("Islandia")).toBeTruthy();
    expect(within(groups[3]).getByText("Boda en Sevilla")).toBeTruthy();
    expect(within(groups[4]).getByText("Roma 2001")).toBeTruthy();
  });

  it("lists a trip shared with the user only under shared, without favorite or delete, even when the trip list includes it", () => {
    // The trips query returns every trip the user may read, shared ones included.
    const sharedInList = { ...summary("sh", "Boda en Sevilla", ["2998-05-01", "2998-05-02"]), userId: "ana" };
    seed([...ownTrips.map((trip) => ({ ...trip, userId: "me" })), sharedInList], shared);
    renderWithI18n(<MyTrips />);
    expect(screen.getAllByRole("article", { name: "Boda en Sevilla" })).toHaveLength(1);
    const sharedCard = card("Boda en Sevilla");
    expect(sharedCard.closest("section")?.querySelector("h2")?.textContent).toBe("Compartidos conmigo");
    expect(within(sharedCard).queryByRole("button", { name: /eliminar/i })).toBeNull();
    expect(within(sharedCard).queryByRole("button", { name: /favorit/i })).toBeNull();
  });

  it("does not list trips the user neither owns nor has been shared", () => {
    const stranger = { ...summary("x", "Viaje ajeno", ["2998-01-01", "2998-01-02"]), userId: "someone" };
    seed([...ownTrips.map((trip) => ({ ...trip, userId: "me" })), stranger], shared);
    renderWithI18n(<MyTrips />);
    expect(screen.queryByRole("article", { name: "Viaje ajeno" })).toBeNull();
  });

  it("hides the groups that are empty", () => {
    seed([ownTrips[2]]);
    renderWithI18n(<MyTrips />);
    expect(groupTitles()).toEqual(["Próximos"]);
  });

  it("shows the trip's counts, its dates or that it has none", () => {
    renderWithI18n(<MyTrips />);
    expect(within(card("Islandia")).getByText("Sin fechas")).toBeTruthy();
    expect(within(card("Islandia")).getByText("5 días / 2 actividades")).toBeTruthy();
    expect(within(card("Lima")).queryByText("Sin fechas")).toBeNull();
    expect(within(card("Lima")).getByText(/2998/)).toBeTruthy();
    expect(within(card("Boda en Sevilla")).getByText("De: ana@x.io")).toBeTruthy();
  });

  it("opens a trip at its own path", () => {
    renderWithI18n(<MyTrips />);
    expect(within(card("Lima")).getByRole("link", { name: "Abrir Lima" }).getAttribute("href")).toBe("/trips/next");
    expect(within(card("Boda en Sevilla")).getByRole("link", { name: "Abrir Boda en Sevilla" }).getAttribute("href")).toBe("/trips/sh");
  });

  it("toggles the favorite through the store", async () => {
    renderWithI18n(<MyTrips />);
    fireEvent.click(within(card("Lima")).getByRole("button", { name: "Marcar como viaje favorito" }));
    await waitFor(() => expect(actions.setTripFavorite).toHaveBeenCalledWith("next"));
    expect(within(card("Tokio")).getByRole("button", { name: "Quitar viaje favorito" })).toBeTruthy();
  });

  it("deletes a trip only after confirming", async () => {
    renderWithI18n(<MyTrips />);
    fireEvent.click(within(card("Roma 2001")).getByRole("button", { name: "Eliminar viaje" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("¿Eliminar este viaje?");
    fireEvent.click(within(dialog).getByRole("button", { name: /Eliminar/ }));
    await waitFor(() => expect(actions.deleteTrip).toHaveBeenCalledWith("past"));
  });

  it("creates a new trip with the same planner as the home page", () => {
    renderWithI18n(<MyTrips />);
    expect(screen.getByRole("link", { name: "Nuevo viaje" }).getAttribute("href")).toBe("/plan");
  });

  it("links back to the current trip when there is one", () => {
    useItineraryStore.setState({ activeTrip: { id: "now", name: "Tokio" } as never });
    renderWithI18n(<MyTrips />);
    expect(screen.getByRole("link", { name: "Volver al viaje" }).getAttribute("href")).toBe("/trips/now");
  });

  it("gives a registered user with no trips a way to create one and the example templates", async () => {
    seed([]);
    renderWithI18n(<MyTrips />);
    expect(screen.getByRole("heading", { name: "Aún no tienes viajes" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Crear un viaje" }).getAttribute("href")).toBe("/plan");
    expect(screen.getByText(TRIP_TEMPLATES[0].name)).toBeTruthy();
    const template = TRIP_TEMPLATES[0];
    act(() => {
      actions.loadTemplate.mockImplementationOnce(() => useItineraryStore.setState({ activeTrip: template.plan }));
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Usar como plantilla" })[0]);
    expect(actions.loadTemplate).toHaveBeenCalledWith(template.plan);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/trips/${template.plan.id}`));
  });

  it("shows skeleton cards while the trips load", () => {
    useItineraryStore.setState({ trips: [], sharedTrips: [], hasFetched: false, loading: true });
    renderWithI18n(<MyTrips />);
    expect(screen.getByRole("status", { name: "Cargando viajes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Aún no tienes viajes" })).toBeNull();
  });

  it("keeps showing the saved trips when offline", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    renderWithI18n(<MyTrips />);
    expect(screen.getByText("Sin conexión: viajes guardados en este dispositivo")).toBeTruthy();
    expect(card("Tokio")).toBeTruthy();
  });

  it("speaks English", () => {
    renderWithI18n(<MyTrips />, "en");
    expect(screen.getByRole("heading", { level: 1, name: "My trips" })).toBeTruthy();
    expect(groupTitles()).toEqual(["In progress", "Upcoming", "Planning", "Shared with me", "Past"]);
    expect(within(card("Islandia")).getByText("No dates")).toBeTruthy();
  });
});
