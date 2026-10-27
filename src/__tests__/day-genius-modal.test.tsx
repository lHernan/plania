// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { makeActivity, renderWithI18n } from "./helpers/dom";
import { I18nProvider } from "@/components/I18nProvider";
import type { TripPlan } from "@/lib/types";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: "fake-token" } } }),
    },
  },
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { DayGeniusModal, GENIUS_TIMEOUT_MS, GEOCODE_TIMEOUT_MS } = await import("@/components/DayGeniusModal");

const trip: TripPlan = {
  id: "t",
  name: "La Palma",
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
  travelContext: { version: 1, arrival: { timeZone: "Atlantic/Canary" } },
  days: [
    {
      id: "d2", date: "2026-11-02", city: "La Palma", label: "", userId: "u",
      activities: [
        makeActivity("hike", { dayId: "d2", title: "Caldera de Taburiente", time: "09:00", durationMin: 120, sort_order: 0 }),
        makeActivity("lunch", { dayId: "d2", title: "Almuerzo", category: "food", time: "12:00", durationMin: 60, sort_order: 1 }),
        makeActivity("park", { dayId: "d2", title: "Parque Cubo de la Galga", location: "Puntallana", time: "14:00", durationMin: 120, sort_order: 2 }),
      ],
    },
    { id: "d3", date: "2026-11-03", city: "La Palma", label: "", userId: "u", activities: [] },
  ],
};

const geniusReply = {
  summary: "Llueve a la tarde: el parque pasa a mañana.",
  weather: {
    hours: [
      { time: "13:00", condition: "cloudy", precipProbability: 20, precipMm: 0, tempC: 20 },
      { time: "14:00", condition: "rain", precipProbability: 90, precipMm: 3, tempC: 18 },
    ],
    days: [],
  },
  rejected: [{ ref: "x", reason: "unknown_id" }],
  changes: [
    { key: "r:lunch", kind: "reschedule", activityId: "lunch", title: "Almuerzo", from: { time: "12:00", durationMin: 60 }, to: { time: "12:30", durationMin: 60 }, reason: "Llegas tarde desde la Caldera" },
    { key: "a:0", kind: "add", suggestion: { title: "Museo Insular", category: "sightseeing", time: "14:30", durationMin: 90, notes: "Verifica el horario" }, replacesId: "park", reason: "Bajo techo" },
    { key: "m:park", kind: "move_day", activityId: "park", title: "Parque Cubo de la Galga", fromTime: "14:00", toDate: "2026-11-03", toTime: "10:00", reason: "90% de lluvia" },
  ],
};

const fetchMock = vi.fn();
const applyDayPlan = vi.fn();
const onClose = vi.fn();
const onToast = vi.fn();

function respond(geniusStatus = 200) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/geocode") return new Response(JSON.stringify({ results: [{ location: "Puntallana", lat: 28.81, lng: -17.77 }] }));
    if (url === "/api/day-genius") return new Response(JSON.stringify(geniusStatus === 200 ? geniusReply : { error: "genius_failed" }), { status: geniusStatus });
    throw new Error(`unexpected ${url}`);
  });
}

const geniusBody = () => JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/day-genius")![1].body as string);
/** Lets pending promises and React updates settle while timers are fake. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

const applyButton = () => screen.queryByRole("button", { name: /Aplicar/ });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T12:20:00Z"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  applyDayPlan.mockReset();
  applyDayPlan.mockResolvedValue({ ok: true });
  onClose.mockReset();
  onToast.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({ activeTrip: trip, applyDayPlan });
  respond();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DayGeniusModal", () => {
  it("plans from the trip-local time with distances and shows the weather, the summary and the changes", async () => {
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    expect(await screen.findByText("Museo Insular")).toBeTruthy();

    const body = geniusBody();
    expect(body).toMatchObject({ today: "2026-11-02", lang: "es", weatherCoords: { lat: 28.81, lng: -17.77 } });
    expect(body.context).toMatchObject({ date: "2026-11-02", mode: "today", now: "12:20", windowStart: "12:20" });
    expect(body.context.fixed).toEqual([expect.objectContaining({ id: "hike", kind: "ongoing" })]);

    expect(screen.getByText("Reorganizamos el resto de tu día desde las 12:20")).toBeTruthy();
    expect(screen.getByText("Asumimos que sigues en «Caldera de Taburiente».")).toBeTruthy();
    expect(screen.getByText(geniusReply.summary)).toBeTruthy();
    expect(screen.getByText("90% lluvia")).toBeTruthy();
    expect(screen.getByLabelText("Lluvia")).toBeTruthy();
    expect(screen.getByText("En lugar de «Parque Cubo de la Galga»")).toBeTruthy();
    expect(screen.getByText("Se descartaron 1 propuestas que no respetaban tus horarios.")).toBeTruthy();
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(applyButton()?.textContent).toBe("Aplicar 3 cambios");
  });

  it("blocks applying while the accepted changes overlap", async () => {
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    await screen.findByText("Museo Insular");

    // Keeping the park today brings back 14:00–16:00, where the museum was proposed.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Parque Cubo de la Galga/ }));
    expect(screen.getByText(/Se solapa con otra actividad/)).toBeTruthy();
    expect((applyButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /^Museo Insular/ }));
    expect(screen.queryByText(/Se solapa con otra actividad/)).toBeNull();
    expect((applyButton() as HTMLButtonElement).disabled).toBe(false);
    expect(applyButton()?.textContent).toBe("Aplicar 1 cambios");
  });

  it("applies only the accepted changes as updates and suggestions", async () => {
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    await screen.findByText("Museo Insular");
    fireEvent.click(applyButton()!);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [ops] = applyDayPlan.mock.calls[0];
    expect(ops.updates).toEqual(expect.arrayContaining([
      { activityId: "lunch", patch: { time: "12:30" } },
      { activityId: "park", patch: { dayId: "d3", time: "10:00", sort_order: 0 } },
    ]));
    expect(ops.additions).toEqual([expect.objectContaining({ title: "Museo Insular", origin: "suggested", dayId: "d2", time: "14:30" })]);
    expect(onToast).toHaveBeenCalledWith("Día reorganizado", "success");
  });

  it("explains when the day cannot be reorganized, without calling the AI", async () => {
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    expect(await screen.findByText("Este día ya pasó: no hay nada que reorganizar.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a retry when the genie fails", async () => {
    respond(502);
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    expect(await screen.findByText(/El genio no pudo reorganizar el día/)).toBeTruthy();
    respond();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Museo Insular")).toBeTruthy();
  });

  it("runs once per open even when the parent re-renders with a new onClose", async () => {
    const view = renderWithI18n(<DayGeniusModal dayId="d2" onClose={() => onClose()} onToast={onToast} />);
    view.rerender(<I18nProvider><DayGeniusModal dayId="d2" onClose={() => onClose()} onToast={onToast} /></I18nProvider>);
    view.rerender(<I18nProvider><DayGeniusModal dayId="d2" onClose={() => onClose()} onToast={onToast} /></I18nProvider>);
    expect(await screen.findByText("Museo Insular")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/geocode")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/day-genius")).toHaveLength(1);
  });

  it("stops waiting and offers a retry when the genie takes too long", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-02T12:20:00Z"));
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/geocode") return Promise.resolve(new Response(JSON.stringify({ results: [] })));
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/api/day-genius", expect.anything());
    await settle(GENIUS_TIMEOUT_MS + 1000);
    expect(screen.getByText(/El genio no pudo reorganizar el día/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("does not wait for a geocoder that never answers", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-02T12:20:00Z"));
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/geocode") return new Promise(() => {});
      return Promise.resolve(new Response(JSON.stringify(geniusReply)));
    });
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    await settle();
    expect(screen.queryByText("Museo Insular")).toBeNull();
    await settle(GEOCODE_TIMEOUT_MS + 1000);
    expect(screen.getByText("Museo Insular")).toBeTruthy();
    expect(geniusBody().context.travel).toEqual([]);
  });

  it("suggests plans for a day that only has a flight and a check-in", async () => {
    const flight = makeActivity("flight", {
      dayId: "d2", title: "Vuelo MAD → SPC", category: "transport", origin: "booking", location: "Madrid Barajas", time: "08:00", durationMin: 165, sort_order: 0,
      booking: { version: 1, groupId: "f", title: "Vuelo", type: "flight", role: "departure", fieldStatus: {}, end: { date: "2026-11-02", time: "09:45" } },
    });
    const hotel = makeActivity("hotel", {
      dayId: "d2", title: "Check-in Hotel Hacienda", category: "hotel", origin: "booking", location: "Hotel Hacienda San Jorge", time: "15:00", durationMin: 30, sort_order: 1,
      booking: { version: 1, groupId: "h", title: "Hotel", type: "lodging", role: "check_in", fieldStatus: {} },
    });
    useItineraryStore.setState({ activeTrip: { ...trip, days: [{ ...trip.days[0], activities: [flight, hotel] }, trip.days[1]] } });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/geocode") {
        return new Response(JSON.stringify({ results: [{ location: "Madrid Barajas", lat: 40.49, lng: -3.57 }, { location: "Hotel Hacienda San Jorge", lat: 28.66, lng: -17.76 }] }));
      }
      return new Response(JSON.stringify({ ...geniusReply, changes: [geniusReply.changes[1]] }));
    });

    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    expect(await screen.findByText("Museo Insular")).toBeTruthy();
    const body = geniusBody();
    expect(body.context.movable).toEqual([]);
    expect(body.context.fixed.map((f: { id: string }) => f.id)).toEqual(["flight", "hotel"]);
    // The weather is the one where the traveler ends the day, not the departure airport.
    expect(body.weatherCoords).toEqual({ lat: 28.66, lng: -17.76 });
    expect(screen.getByText("Ideas para tu tiempo libre desde las 12:20")).toBeTruthy();
  });

  it("asks for a city when the day has nothing to place suggestions near", async () => {
    useItineraryStore.setState({ activeTrip: { ...trip, days: [{ ...trip.days[0], city: "New destination", activities: [] }, trip.days[1]] } });
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    expect(await screen.findByText("Añade la ciudad de este día para que el genio pueda sugerirte planes.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the apply error and keeps the modal open", async () => {
    applyDayPlan.mockResolvedValue({ ok: false, error: "boom" });
    renderWithI18n(<DayGeniusModal dayId="d2" onClose={onClose} onToast={onToast} />);
    await screen.findByText("Museo Insular");
    fireEvent.click(applyButton()!);
    expect(await screen.findByText("No se pudieron aplicar los cambios: boom")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
