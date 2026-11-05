// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";
import type { Activity, ActivityFile, BookingDetails, TripDay, TripPlan } from "@/lib/types";

const offline = vi.hoisted(() => ({ cached: new Set<string>() }));
vi.mock("@/lib/offline-documents", () => ({
  getCachedDocumentAvailability: async (url: string) => offline.cached.has(url),
  cacheDocumentForOffline: vi.fn(async () => true),
}));

const { WalletView } = await import("@/components/WalletView");

function file(id: string, activityId: string, fileName: string): ActivityFile {
  return { id, activityId, tripId: "t", userId: "u", fileUrl: `https://files/${id}.pdf`, filePath: id, fileType: "pdf", fileName, createdAt: "" };
}

const flight: BookingDetails = {
  version: 1,
  type: "flight",
  role: "single",
  groupId: "fl",
  title: "Madrid → Tokio",
  provider: "Iberia",
  reference: "XYZ789",
  start: { date: "2026-10-26", time: "08:15" },
  fieldStatus: {},
};

function activity(id: string, overrides: Partial<Activity>): Activity {
  return { id, dayId: "d1", tripId: "t", userId: "u", city: "Tokyo", title: id, time: "10:00", durationMin: 60, category: "other", priority: "medium", state: "pending", sort_order: 0, ...overrides };
}

const pass = file("f1", "a1", "boarding-pass.pdf");
const museum = file("f2", "a2", "museum.pdf");

function trip(activities: Activity[]): TripPlan {
  const day: TripDay = { id: "d1", date: "2026-10-26", city: "Tokyo", label: "d1", activities, userId: "u" };
  return { id: "t", name: "Trip", days: [day], criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [] };
}

const fullTrip = trip([
  activity("a1", { title: "Flight to Tokyo", origin: "booking", booking: flight, files: [pass] }),
  activity("a2", { title: "Museum", time: "15:00", files: [museum] }),
]);

function renderWallet(props: Partial<Parameters<typeof WalletView>[0]> = {}, lang: "es" | "en" = "es") {
  const handlers = { onOpenDocument: vi.fn(), onImportBookings: vi.fn(), onShowActivity: vi.fn() };
  renderWithI18n(
    <WalletView
      trip={fullTrip}
      today={null}
      canImportBookings
      reservations={<section data-testid="reservations" />}
      {...handlers}
      {...props}
    />,
    lang
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  offline.cached.clear();
});

describe("WalletView", () => {
  it("switches between the bookings and documents tabs with tab semantics", () => {
    renderWallet();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Reservas", "Documentos"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0].id);

    fireEvent.click(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1].id);
    expect(within(panel).getByText("museum.pdf")).toBeTruthy();
    expect(screen.queryByTestId("reservations")).toBeNull();
  });

  it("shows the booking with its details and the to-book block", () => {
    renderWallet();
    const card = screen.getByRole("article", { name: "Madrid → Tokio" });
    expect(within(card).getByText("Iberia")).toBeTruthy();
    expect(within(card).getByText("XYZ789")).toBeTruthy();
    expect(within(card).getByText(/08:15/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Vuelos" })).toBeTruthy();
    expect(screen.getByTestId("reservations")).toBeTruthy();
  });

  it("opens a booking's document in one tap", () => {
    const { onOpenDocument } = renderWallet();
    const card = screen.getByRole("article", { name: "Madrid → Tokio" });
    fireEvent.click(within(card).getByRole("button", { name: /boarding-pass\.pdf/ }));
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
    expect(onOpenDocument).toHaveBeenCalledWith(pass, "Flight to Tokyo");
  });

  it("goes to the booking's activity in the itinerary", () => {
    const { onShowActivity } = renderWallet();
    fireEvent.click(screen.getByRole("button", { name: "Ver en el itinerario" }));
    expect(onShowActivity).toHaveBeenCalledWith("d1", "a1");
  });

  it("puts today's bookings first while the trip is in progress", () => {
    renderWallet({ today: "2026-10-26" });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Hoy");
    // Shown once: today's booking leaves its type group.
    expect(headings).not.toContain("Vuelos");
    expect(screen.getAllByRole("article", { name: "Madrid → Tokio" })).toHaveLength(1);
  });

  it("has no today group outside the trip", () => {
    renderWallet({ today: null });
    expect(screen.queryByRole("heading", { name: "Hoy" })).toBeNull();
  });

  it("opens a document from the documents tab in one tap and shows its offline state", async () => {
    offline.cached.add("https://files/f2.pdf");
    const { onOpenDocument } = renderWallet();
    fireEvent.click(screen.getByRole("tab", { name: "Documentos" }));
    await act(async () => {});
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Museum")).toBeTruthy();
    expect(within(panel).getByText("Disponible offline")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /museum\.pdf/ }));
    expect(onOpenDocument).toHaveBeenCalledWith(museum, "Museum");
  });

  it("invites to import bookings when there are none, for the owner", () => {
    const { onImportBookings } = renderWallet({ trip: trip([activity("a2", { title: "Museum" })]) });
    expect(screen.getByText("Sube tus reservas y Tachao las ordena por ti")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Importar reservas" }));
    expect(onImportBookings).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("reservations")).toBeTruthy();
  });

  it("hides the import button from invitees", () => {
    renderWallet({ trip: trip([]), canImportBookings: false });
    expect(screen.getByText("Sube tus reservas y Tachao las ordena por ti")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Importar reservas" })).toBeNull();
  });

  it("explains the empty documents tab", () => {
    renderWallet({ trip: trip([]) });
    fireEvent.click(screen.getByRole("tab", { name: "Documentos" }));
    expect(screen.getByText("Los billetes, entradas y confirmaciones que adjuntes a tus actividades aparecerán aquí.")).toBeTruthy();
  });

  it("speaks English", () => {
    renderWallet({}, "en");
    expect(screen.getByRole("tab", { name: "Bookings" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Documents" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Flights" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show in itinerary" })).toBeTruthy();
    cleanup();
    renderWallet({ today: "2026-10-26" }, "en");
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
  });
});
