// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";
import type { CriticalReservation, TripPlan } from "@/lib/types";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({}), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } },
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { CriticalReservationsPanel } = await import("@/components/CriticalReservationsPanel");

const reservation = (id: string, title: string, extra: Partial<CriticalReservation> = {}): CriticalReservation => ({
  id, userId: "u", title, bookingDeadline: "2026-11-01", reservationDate: "2026-11-03", urgency: "safe", status: "pending", ...extra,
});

const reservations = () => useItineraryStore.getState().activeTrip!.criticalReservations;
const setReservations = (list: CriticalReservation[]) =>
  useItineraryStore.setState({ activeTrip: { ...useItineraryStore.getState().activeTrip!, criticalReservations: list } });

const toggleBooking = vi.fn(async (id: string) =>
  setReservations(reservations().map((r) => (r.id === id ? { ...r, status: r.status === "booked" ? "pending" as const : "booked" as const } : r))));
const addReservation = vi.fn(async (r: Omit<CriticalReservation, "id" | "userId">) => setReservations([...reservations(), { ...r, id: "new", userId: "u" }]));
const patchReservation = vi.fn(async (id: string, patch: Partial<CriticalReservation>) => setReservations(reservations().map((r) => (r.id === id ? { ...r, ...patch } : r))));
const removeReservation = vi.fn(async (id: string) => setReservations(reservations().filter((r) => r.id !== id)));
const onBooked = vi.fn();

const trip = (list: CriticalReservation[]): TripPlan => ({ id: "t", name: "La Palma", criticalReservations: list, shoppingItems: [], ignoredShoppingSuggestionKeys: [], days: [] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T10:00:00Z"));
  for (const m of [toggleBooking, addReservation, patchReservation, removeReservation, onBooked]) m.mockClear();
  useItineraryStore.setState({ activeTrip: trip([]), toggleBooking, addReservation, patchReservation, removeReservation });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const render = (canEdit = true) => renderWithI18n(<CriticalReservationsPanel canEdit={canEdit} onBooked={onBooked} />);

describe("CriticalReservationsPanel", () => {
  it("lists what to book with its dates and how close the deadline is", () => {
    useItineraryStore.setState({ activeTrip: trip([
      reservation("r1", "Cena en El Jardín", { bookingDeadline: "2026-11-01", price: 45 }),
      reservation("r2", "Teide teleférico", { bookingDeadline: "2026-10-29" }),
      reservation("r3", "Hotel", { status: "booked" }),
    ]) });
    render();
    const row = screen.getByRole("listitem", { name: "Cena en El Jardín" });
    expect(within(row).getByText("Faltan 2 días para reservar")).toBeTruthy();
    expect(within(row).getByText(/3 nov/)).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "Teide teleférico" })).getByText("El plazo ya pasó")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "Hotel" })).getByText("Reservado")).toBeTruthy();
  });

  it("celebrates only when a reservation is checked as booked", async () => {
    useItineraryStore.setState({ activeTrip: trip([reservation("r1", "Cena en El Jardín")]) });
    render();
    fireEvent.click(screen.getByRole("checkbox", { name: "Cena en El Jardín" }));
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith("Cena en El Jardín"));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Cena en El Jardín" }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "Cena en El Jardín" }));
    await waitFor(() => expect(toggleBooking).toHaveBeenCalledTimes(2));
    expect(onBooked).toHaveBeenCalledTimes(1);
  });

  it("adds a reservation from a modal with labeled fields", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "Nueva reserva" }));
    const dialog = screen.getByRole("dialog", { name: "Nueva reserva" });
    fireEvent.change(within(dialog).getByLabelText("Qué tienes que reservar"), { target: { value: "Cena en El Jardín" } });
    fireEvent.change(within(dialog).getByLabelText("Reservar antes del"), { target: { value: "2026-11-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(addReservation).toHaveBeenCalledWith(expect.objectContaining({ title: "Cena en El Jardín", bookingDeadline: "2026-11-01", status: "pending" })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("edits, closes on save, and deletes only after an in-app confirmation", async () => {
    const native = vi.spyOn(window, "confirm");
    useItineraryStore.setState({ activeTrip: trip([reservation("r1", "Cena")]) });
    render();
    fireEvent.click(screen.getByRole("button", { name: "Editar «Cena»" }));
    const dialog = screen.getByRole("dialog", { name: "Editar reserva" });
    fireEvent.change(within(dialog).getByLabelText("Qué tienes que reservar"), { target: { value: "Cena en El Jardín" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(patchReservation).toHaveBeenCalledWith("r1", expect.objectContaining({ title: "Cena en El Jardín" })));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Editar «Cena en El Jardín»" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar reserva" }));
    expect(removeReservation).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(removeReservation).toHaveBeenCalledWith("r1"));
    expect(native).not.toHaveBeenCalled();
  });

  it("is read-only for people the trip was shared with", () => {
    useItineraryStore.setState({ activeTrip: trip([reservation("r1", "Cena")]) });
    render(false);
    expect(screen.queryByRole("button", { name: "Nueva reserva" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar «Cena»" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Cena" }) as HTMLInputElement).disabled).toBe(true);
  });
});
