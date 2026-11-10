// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { ChatAction, ChatMessage, TripPlan } from "@/lib/types";

// S3 (odd/tasks/growth-quick-wins.md): "Propone y confirmás". Tachi's proposals show as a card
// with Aplicar / Descartar; nothing changes without the user's click, and only editors see buttons.
const rpc = vi.hoisted(() => ({ calls: [] as [string, Record<string, unknown>][], saveError: null as { code: string; message: string } | null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpc.calls.push([fn, args]);
      if (fn === "trip_members") {
        return {
          data: [
            { user_id: "hernan", email: "hernan@x.io", is_owner: true, display_name: "Hernán L" },
            { user_id: "jack", email: "jack@x.io", is_owner: false, display_name: "Jack" },
            { user_id: "marly", email: "marly@x.io", is_owner: false, display_name: null },
          ],
          error: null,
        };
      }
      return rpc.saveError ? { data: null, error: rpc.saveError } : { data: "new-expense", error: null };
    },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

import { ChatPanel } from "@/components/ChatPanel";
import { useChatStore } from "@/store/use-chat-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { clearTripMembersCache } from "@/components/memories/use-trip-members";

const initialChat = useChatStore.getState();

const addAction: ChatAction = {
  type: "add_activity",
  payload: { dayId: "d1", city: "Madrid", title: "Museo del Prado", time: "10:00", durationMin: 120, category: "sightseeing", priority: "medium", state: "pending", notes: "", location: "", mapsUrl: "", reservationUrl: "" },
};
const patchAction: ChatAction = { type: "patch_activity", payload: { dayId: "d1", activityId: "a1", patch: { time: "11:30" } } };
const stateAction: ChatAction = { type: "update_activity_state", payload: { dayId: "d2", activityId: "b1", state: "skipped" } };
const reorderAction: ChatAction = { type: "reorder_activities", payload: { dayId: "d1", orderedActivityIds: ["a2", "a1"] } };
const reservationAction: ChatAction = {
  type: "add_reservation",
  payload: { title: "Entradas Prado", bookingDeadline: "2026-10-20", reservationDate: "2026-10-27", bookingLink: "", urgency: "safe", status: "pending" },
};

function trip(undated = false): TripPlan {
  const base = makeTrip([
    { ...makeDay("d1", [makeActivity("a1", { title: "Retiro", sort_order: 0 }), makeActivity("a2", { title: "Sol", sort_order: 1 })]), date: "2026-10-27" },
    { ...makeDay("d2", [makeActivity("b1", { title: "Toledo" })]), date: "2026-10-28" },
  ]);
  return { ...base, id: "trip-1", travelContext: undated ? { undated: true } as TripPlan["travelContext"] : undefined };
}

const store = {
  addActivity: vi.fn(async () => {}),
  patchActivity: vi.fn(async () => {}),
  updateActivityState: vi.fn(async () => true),
  reorderActivitiesToOrder: vi.fn(async () => {}),
  addReservation: vi.fn(async () => {}),
};

function message(id: string, actions: ChatAction[]): ChatMessage {
  return { id, tripId: "trip-1", userId: "u", role: "assistant", content: `Reply ${id}`, actions, createdAt: "2026-11-06T10:00:00Z" };
}

function setChat(messages: ChatMessage[], proposals: Record<string, "pending" | "applied" | "dismissed"> = {}) {
  useChatStore.setState({ messages, proposals, loadedTripId: "trip-1", loadingHistory: false, sending: false, error: null, loadMessages: vi.fn(async () => {}) });
}

beforeEach(() => {
  rpc.calls = [];
  rpc.saveError = null;
  clearTripMembersCache();
  mockMatchMedia();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.values(store).forEach((fn) => fn.mockClear());
  useItineraryStore.setState({ activeTrip: trip(), ...store });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Tachi proposal card", () => {
  it("lists each change in plain language on a dated trip", async () => {
    setChat([message("m1", [addAction, patchAction, stateAction, reorderAction, reservationAction])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");

    expect(await screen.findByText("Agregar «Museo del Prado» · mar 27 oct · 10:00")).toBeTruthy();
    expect(screen.getByText("Cambiar «Retiro» · mar 27 oct: hora 11:30")).toBeTruthy();
    expect(screen.getByText("Marcar «Toledo» como omitida")).toBeTruthy();
    expect(screen.getByText("Reordenar las actividades de mar 27 oct")).toBeTruthy();
    expect(screen.getByText("Nueva reserva «Entradas Prado» · mar 27 oct")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeTruthy();
  });

  it("names the days by number on an undated trip", async () => {
    useItineraryStore.setState({ activeTrip: trip(true) });
    setChat([message("m1", [addAction, stateAction])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "en");

    expect(await screen.findByText("Add “Museo del Prado” · Day 1 · 10:00")).toBeTruthy();
    expect(screen.getByText("Mark “Toledo” as skipped")).toBeTruthy();
  });

  it("applies the changes in order through the itinerary store and marks the card applied", async () => {
    setChat([message("m1", [addAction, patchAction, stateAction, reorderAction, reservationAction])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");

    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(screen.getByText("Cambios aplicados")).toBeTruthy());
    expect(store.addActivity).toHaveBeenCalledWith(expect.objectContaining({
      dayId: "d1", city: "Madrid", title: "Museo del Prado", time: "10:00", durationMin: 120, category: "sightseeing", sort_order: 2, files: [],
    }));
    expect(store.patchActivity).toHaveBeenCalledWith("d1", "a1", { time: "11:30" });
    expect(store.updateActivityState).toHaveBeenCalledWith("d2", "b1", "skipped");
    expect(store.reorderActivitiesToOrder).toHaveBeenCalledWith("d1", ["a2", "a1"]);
    expect(store.addReservation).toHaveBeenCalledWith(reservationAction.payload);
    expect(store.addActivity.mock.invocationCallOrder[0]).toBeLessThan(store.addReservation.mock.invocationCallOrder[0]);
    expect(useChatStore.getState().proposals.m1).toBe("applied");
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
  });

  it("skips the changes whose day or activity no longer exists and says so", async () => {
    const gone: ChatAction = { type: "patch_activity", payload: { dayId: "d1", activityId: "deleted", patch: { time: "12:00" } } };
    setChat([message("m1", [gone, stateAction])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");

    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(screen.getByText("Cambios aplicados")).toBeTruthy());
    expect(screen.getByText("1 cambio ya no aplica y se omitió.")).toBeTruthy();
    expect(store.patchActivity).not.toHaveBeenCalled();
    expect(store.updateActivityState).toHaveBeenCalledWith("d2", "b1", "skipped");
  });

  it("keeps the card pending with an error when nothing could be applied", async () => {
    const gone: ChatAction = { type: "reorder_activities", payload: { dayId: "removed-day", orderedActivityIds: ["x"] } };
    setChat([message("m1", [gone])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");

    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));

    expect(await screen.findByText("No se pudo aplicar ningún cambio: el viaje cambió desde la propuesta.")).toBeTruthy();
    expect(useChatStore.getState().proposals.m1).toBe("pending");
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeTruthy();
    expect(store.reorderActivitiesToOrder).not.toHaveBeenCalled();
  });

  it("discards a proposal without touching the trip", async () => {
    setChat([message("m1", [addAction])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");

    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));

    expect(await screen.findByText("Propuesta descartada")).toBeTruthy();
    expect(useChatStore.getState().proposals.m1).toBe("dismissed");
    expect(store.addActivity).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
  });

  it("never shows the buttons to a viewer", async () => {
    setChat([message("m1", [addAction])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" />, "es");

    expect(await screen.findByText("Reply m1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
  });

  it("shows history proposals as a passive note, never actionable", async () => {
    setChat([message("old", [addAction, patchAction])]);
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");

    expect(await screen.findByText("Tachi propuso 2 cambios")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    expect(screen.queryByText(/aplicados al plan/)).toBeNull();
  });
});

describe("chat store proposals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks the actions of a reply received this session as pending, but not history", async () => {
    useChatStore.setState(initialChat, true);
    const reply = message("m9", [addAction]);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(
      JSON.stringify(init?.method === "POST" ? { message: reply, actions: [addAction] } : { messages: [message("h1", [addAction])] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await useChatStore.getState().loadMessages("trip-1");
    expect(useChatStore.getState().proposals).toEqual({});

    await useChatStore.getState().sendMessage("trip-1", "agrega el Prado", "es");
    expect(useChatStore.getState().proposals).toEqual({ m9: "pending" });
    expect(useChatStore.getState().messages.map((item) => item.id)).toEqual(["h1", expect.stringMatching(/^local-/), "m9"]);
  });
});

// S1, S4 (odd/tasks/tachi-expenses.md): "jacke y yo pagamos el hotel, marly nos debe 100 euros".
describe("Tachi expense proposals", () => {
  const hotel: ChatAction = {
    type: "add_expense",
    payload: {
      title: "Hotel",
      amountCents: 30000,
      currency: "EUR",
      spentOn: "2026-11-10",
      category: "lodging",
      activityId: "a1",
      payers: [
        { userId: "hernan", paidCents: 15000 },
        { userId: "jack", paidCents: 15000 },
      ],
      splitMethod: "equal",
      splits: [
        { userId: "hernan", shareCents: 10000 },
        { userId: "jack", shareCents: 10000 },
        { userId: "marly", shareCents: 10000 },
      ],
      notes: null,
    },
  };
  const saves = () => rpc.calls.filter(([fn]) => fn === "save_expense");

  it("describes the expense with every payer and saves it through save_expense", async () => {
    setChat([message("m1", [hotel])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");

    const line = await screen.findByText(/Añadir gasto «Hotel»/);
    await waitFor(() => expect(line.textContent?.replace(/ /g, " ")).toBe("Añadir gasto «Hotel» · 300,00 € · Pagaron Hernán y Jack · entre Hernán, Jack, marly"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0][1]).toEqual({
      p_expense: { trip_id: "trip-1", activity_id: "a1", title: "Hotel", amount_cents: 30000, currency: "EUR", spent_on: "2026-11-10", category: "lodging", split_method: "equal", notes: null },
      p_payers: [
        { user_id: "hernan", paid_cents: 15000 },
        { user_id: "jack", paid_cents: 15000 },
      ],
      p_splits: [
        { user_id: "hernan", share_cents: 10000, percent_bp: null },
        { user_id: "jack", share_cents: 10000, percent_bp: null },
        { user_id: "marly", share_cents: 10000, percent_bp: null },
      ],
    });
    expect(await screen.findByText("Cambios aplicados")).toBeTruthy();
    expect(store.addActivity).not.toHaveBeenCalled();
  });

  it("lets a viewer apply a proposal made only of expenses", async () => {
    setChat([message("m1", [hotel])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" />, "es");
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
  });

  it("keeps the card pending with an error when the expense is rejected", async () => {
    rpc.saveError = { code: "23514", message: "save_expense: the payers do not add up to the amount" };
    setChat([message("m1", [hotel])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeTruthy();
  });

  it("saves the expense without its activity when the activity is gone", async () => {
    setChat([message("m1", [{ ...hotel, payload: { ...hotel.payload, activityId: "deleted" } } as ChatAction])], { m1: "pending" });
    renderWithI18n(<ChatPanel tripId="trip-1" canEdit />, "es");
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect((saves()[0][1].p_expense as Record<string, unknown>).activity_id).toBeNull();
  });
});
