// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { makeActivity, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { ExtractedBooking } from "@/lib/bookings/extract";
import type { Activity, TripDay, TripPlan } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks: Supabase (DB + session), the browser PDF reader and fetch.
// ---------------------------------------------------------------------------

const remote = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[][],
  error: null as null | { message: string },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: async (rows: Record<string, unknown>[]) => {
        remote.inserts.push(rows);
        return { error: remote.error };
      },
    }),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: "fake-token" } } }),
    },
  },
}));

const pdf = vi.hoisted(() => ({
  failing: new Set<string>(),
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock("@/lib/pdf/read-pdf", () => {
  class PdfReadError extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  const SHA: Record<string, string> = { "vuelos.pdf": "a", "coche.pdf": "b", "airbnb.pdf": "c", "roto.pdf": "d", "excursion.pdf": "e", "entrada.pdf": "f", "ana.pdf": "1", "luis.pdf": "2", "sofia.pdf": "3", "pase-luis.pdf": "4" };
  return {
    PdfReadError,
    readPdf: async (file: File) => {
      pdf.inFlight += 1;
      pdf.maxInFlight = Math.max(pdf.maxInFlight, pdf.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (pdf.failing.has(file.name)) {
        pdf.inFlight -= 1;
        throw new PdfReadError("invalid");
      }
      return { sha256: (SHA[file.name] ?? "9").repeat(64), pageCount: 1, pages: [{ index: 0, text: `fake ${file.name}` }], imagePages: [] };
    },
  };
});

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { BookingImportModal } = await import("@/components/BookingImportModal");
const realAddActivitiesBatch = useItineraryStore.getState().addActivitiesBatch;

// ---------------------------------------------------------------------------
// FAKE La Palma-like trip and bookings.
// ---------------------------------------------------------------------------

const DATES = ["2031-05-10", "2031-05-11", "2031-05-12", "2031-05-13"];
const CITIES = ["Santa Cruz de La Palma", "Los Llanos de Aridane", "Los Llanos de Aridane", "Santa Cruz de La Palma"];

function makeTrip(dayActivities: Record<string, Activity[]> = {}, dates = DATES): TripPlan {
  const days: TripDay[] = dates.map((date, i) => ({
    id: `d${i + 1}`,
    date,
    city: CITIES[i],
    label: `Día ${i + 1}`,
    activities: dayActivities[`d${i + 1}`] ?? [],
    userId: "owner",
  }));
  return {
    id: "trip-la-palma",
    name: "La Palma (fake)",
    // No userId: the store then skips its IndexedDB offline cache, unavailable in jsdom.
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    days,
    criticalReservations: [],
    shoppingItems: [],
    ignoredShoppingSuggestionKeys: [],
  };
}

const extracted = (fields: Partial<ExtractedBooking> & Pick<ExtractedBooking, "id" | "type" | "title">): ExtractedBooking => ({
  fieldStatus: { title: "extracted", startDate: "extracted", startTime: "extracted" },
  warnings: [],
  ...fields,
});

const BOOKINGS: Record<string, { bookings: ExtractedBooking[]; warnings: string[] }> = {
  "vuelos.pdf": {
    warnings: [],
    bookings: [
      extracted({ id: "aaaaaaaa-0", type: "flight", title: "Vuelo MAD → SPC", provider: "Fake Air", reference: "FAKE01", from: "MAD", to: "SPC", start: { date: "2031-05-10", time: "08:00", timeZone: "Europe/Madrid" }, end: { date: "2031-05-10", time: "09:45", timeZone: "Atlantic/Canary" }, source: { fileName: "vuelos.pdf", sha256: "a".repeat(64) } }),
      extracted({ id: "aaaaaaaa-1", type: "flight", title: "Vuelo SPC → MAD", provider: "Fake Air", reference: "FAKE02", from: "SPC", to: "MAD", start: { date: "2031-05-13", time: "19:00" }, end: { date: "2031-05-13", time: "22:40" }, source: { fileName: "vuelos.pdf", sha256: "a".repeat(64) } }),
    ],
  },
  "coche.pdf": {
    warnings: ["text_truncated"],
    bookings: [
      extracted({ id: "bbbbbbbb-0", type: "car_rental", title: "Coche Fake Cars", provider: "Fake Cars", reference: "CAR42", pickupLocation: "Aeropuerto SPC", start: { date: "2031-05-10", time: "10:30" }, end: { date: "2031-05-13", time: "17:00" }, source: { fileName: "coche.pdf", sha256: "b".repeat(64) } }),
    ],
  },
  "airbnb.pdf": {
    warnings: [],
    bookings: [
      extracted({ id: "cccccccc-0", type: "lodging", title: "Casa Fake en Los Llanos", provider: "FakeBnB", address: "Calle Falsa 1, Los Llanos", start: { date: "2031-05-10", time: "16:00" }, end: { date: "2031-05-13", time: "11:00" }, fieldStatus: { title: "extracted", startDate: "extracted", startTime: "needs_confirmation" }, source: { fileName: "airbnb.pdf", sha256: "c".repeat(64) } }),
    ],
  },
  "entrada.pdf": {
    warnings: [],
    bookings: [
      extracted({ id: "ffffffff-0", type: "ticket", title: "Entrada observatorio (fake)", warnings: ["missing:startDate"], fieldStatus: { title: "extracted", startDate: "needs_confirmation" }, source: { fileName: "entrada.pdf", sha256: "f".repeat(64) } }),
    ],
  },
  "excursion.pdf": {
    warnings: [],
    bookings: [
      extracted({ id: "eeeeeeee-0", type: "ticket", title: "Excursión en barco (fake)", start: { date: "2031-05-10", time: "10:00" }, source: { fileName: "excursion.pdf", sha256: "e".repeat(64) } }),
    ],
  },
  "roto.pdf": { warnings: [], bookings: [] },
  ...Object.fromEntries(
    ([["ana.pdf", "1", "Ana García", "14C"], ["luis.pdf", "2", "Luis García", "14D"], ["sofia.pdf", "3", "Sofía García", "14E"]] as const).map(([name, sha, passenger, seat]) => [
      name,
      { warnings: [], bookings: [
        extracted({ id: `${sha.repeat(8)}-0`, type: "flight", title: "Vuelo MAD → SPC", provider: "Iberia", reference: "XK7Q2P", from: "MAD", to: "SPC", start: { date: "2031-05-10", time: "08:00" }, end: { date: "2031-05-10", time: "09:45" }, passengers: [{ name: passenger, seat }], source: { fileName: name, sha256: sha.repeat(64) } }),
        extracted({ id: `${sha.repeat(8)}-1`, type: "flight", title: "Vuelo SPC → MAD", provider: "Iberia", reference: "XK7Q2P", from: "SPC", to: "MAD", start: { date: "2031-05-13", time: "19:00" }, end: { date: "2031-05-13", time: "22:40" }, passengers: [{ name: passenger }], source: { fileName: name, sha256: sha.repeat(64) } }),
      ] },
    ]),
  ),
  "pase-luis.pdf": { warnings: [], bookings: [
    extracted({ id: "44444444-0", type: "flight", title: "Vuelo MAD → SPC", provider: "Iberia", reference: "XK7Q2P", from: "MAD", to: "SPC", start: { date: "2031-05-10", time: "08:00" }, passengers: [{ name: "Luis García", seat: "14D" }], source: { fileName: "pase-luis.pdf", sha256: "4".repeat(64) } }),
  ] },
};

let importerResponse: unknown = { activities: [] };
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (url === "/api/bookings/extract") {
    pdf.inFlight -= 1;
    return new Response(JSON.stringify(BOOKINGS[body.fileName] ?? { bookings: [], warnings: [] }), { status: 200 });
  }
  if (url === "/api/import") return new Response(JSON.stringify(importerResponse), { status: 200 });
  return new Response("{}", { status: 404 });
});

const uploadActivityFile = vi.fn(async (activityId: string, file: File) => {
  void activityId;
  void file;
});
const fetchActiveTrip = vi.fn(async () => {});
const patchActivity = vi.fn(async () => {});
const onClose = vi.fn();
const onToast = vi.fn();

function load(trip: TripPlan) {
  useItineraryStore.setState({ activeTrip: trip, trips: [], error: null, fetchActiveTrip, uploadActivityFile, patchActivity, addActivitiesBatch: realAddActivitiesBatch });
}

const pdfFile = (name: string) => new File(["%PDF-1.7 fake"], name, { type: "application/pdf" });

function renderModal() {
  return renderWithI18n(<BookingImportModal onClose={onClose} onToast={onToast} />, "es");
}

async function selectFiles(names: string[]) {
  const input = screen.getByLabelText("Documentos PDF de tus reservas");
  fireEvent.change(input, { target: { files: names.map(pdfFile) } });
  await waitFor(() => expect(screen.getAllByText(/^(Reservas detectadas|No es un PDF)/)).toHaveLength(names.length));
}

const confirmButton = () => screen.getByRole("button", { name: /^Confirmar reservas/ });
const fetchCalls = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);

beforeEach(() => {
  mockMatchMedia();
  remote.inserts = [];
  remote.error = null;
  pdf.failing = new Set();
  pdf.inFlight = 0;
  pdf.maxInFlight = 0;
  importerResponse = { activities: [] };
  fetchMock.mockClear();
  uploadActivityFile.mockClear();
  fetchActiveTrip.mockClear();
  patchActivity.mockClear();
  onClose.mockClear();
  onToast.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  load(makeTrip());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BookingImportModal", () => {
  it("is an accessible dialog that discloses where documents are sent", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Importar reservas" });
    expect(dialog).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.getByText(/se leen en este navegador/)).toBeTruthy();
  });

  it("processes several PDFs, reports the unreadable one and lets it be retried", async () => {
    pdf.failing.add("roto.pdf");
    renderModal();
    await selectFiles(["vuelos.pdf", "roto.pdf", "coche.pdf"]);

    expect(within(screen.getByTestId("file-row-vuelos.pdf")).getByText("Reservas detectadas: 2")).toBeTruthy();
    expect(within(screen.getByTestId("file-row-coche.pdf")).getByText("Reservas detectadas: 1")).toBeTruthy();
    expect(within(screen.getByTestId("file-row-coche.pdf")).getByText(/solo se analizó la primera parte/)).toBeTruthy();
    expect(within(screen.getByTestId("file-row-roto.pdf")).getByText("No es un PDF válido o está dañado.")).toBeTruthy();
    expect(pdf.maxInFlight).toBeLessThanOrEqual(3);
    expect(fetchCalls("/api/bookings/extract")).toHaveLength(2);
    const [, init] = fetchCalls("/api/bookings/extract")[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fake-token");
    // The trip dates travel with each document so dates printed without a year can be completed.
    const trip = useItineraryStore.getState().activeTrip!;
    expect(JSON.parse(String(init?.body))).toMatchObject({ tripStartDate: trip.startDate, tripEndDate: trip.endDate });

    // A failed file never blocks the others from being reviewed…
    expect((screen.getByRole("button", { name: "Revisar reservas" }) as HTMLButtonElement).disabled).toBe(false);

    // …and can be retried without starting over.
    pdf.failing.delete("roto.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar roto.pdf" }));
    await waitFor(() => expect(within(screen.getByTestId("file-row-roto.pdf")).getByText("Reservas detectadas: 0")).toBeTruthy());
    expect(within(screen.getByTestId("file-row-vuelos.pdf")).getByText("Reservas detectadas: 2")).toBeTruthy();
  });

  it("highlights ambiguous and missing fields as «Revisar» and blocks confirm until reviewed", async () => {
    renderModal();
    await selectFiles(["airbnb.pdf", "entrada.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));

    const stay = screen.getByTestId("booking-card-cccccccc-0");
    expect(within(stay).getAllByText("Revisar").length).toBeGreaterThan(0);
    const ticket = screen.getByTestId("booking-card-ffffffff-0");
    expect(within(ticket).getByText("Falta: Fecha de inicio")).toBeTruthy();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("confirm-blocked-reason").textContent).toMatch(/Reservas pendientes: 2/);

    fireEvent.click(within(stay).getByRole("button", { name: "Lo he revisado" }));
    // Reviewing never invents a missing date: the ticket still blocks.
    fireEvent.click(within(ticket).getByRole("button", { name: "Lo he revisado" }));
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);

    // Editing with an invalid date is rejected; a valid one resolves the doubt.
    fireEvent.click(within(ticket).getByRole("button", { name: "Editar" }));
    fireEvent.change(within(ticket).getByLabelText(/Fecha de inicio/), { target: { value: "2031-05-12" } });
    fireEvent.click(within(ticket).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect((confirmButton() as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows a duplicate of an already imported booking, excluded by default", async () => {
    const saved = makeActivity("saved-flight", {
      origin: "booking",
      booking: { version: 1, type: "flight", role: "departure", groupId: "g0", title: "Vuelo", reference: "FAKE01", fieldStatus: {} },
    });
    load(makeTrip({ d1: [saved] }));
    renderModal();
    await selectFiles(["vuelos.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));

    const outbound = screen.getByTestId("booking-card-aaaaaaaa-0");
    expect(within(outbound).getByText("Ya importada")).toBeTruthy();
    expect(within(outbound).getByText(/mismo localizador/)).toBeTruthy();
    expect((within(outbound).getByRole("checkbox", { name: "Incluir" }) as HTMLInputElement).checked).toBe(false);
    expect(confirmButton().textContent).toBe("Confirmar reservas (1)");
  });

  it("cancelling before confirm persists nothing and uploads nothing", async () => {
    const batch = vi.fn();
    useItineraryStore.setState({ addActivitiesBatch: batch });
    renderModal();
    await selectFiles(["vuelos.pdf", "coche.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText("¿Salir sin guardar?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salir sin guardar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
    expect(uploadActivityFile).not.toHaveBeenCalled();
    expect(remote.inserts).toHaveLength(0);
  });

  it("confirm saves booking activities in one batch on the right days and uploads each file once", async () => {
    renderModal();
    await selectFiles(["vuelos.pdf", "coche.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));
    fireEvent.click(confirmButton());

    await screen.findByText("¡Reservas en su sitio!");
    expect(remote.inserts).toHaveLength(1);
    const [rows] = remote.inserts;
    expect(rows.map((r) => [r.day_id, r.origin, (r.booking as { role: string }).role])).toEqual([
      ["d1", "booking", "departure"],
      ["d4", "booking", "departure"],
      ["d1", "booking", "pickup"],
      ["d4", "booking", "dropoff"],
    ]);
    expect(uploadActivityFile).toHaveBeenCalledTimes(2);
    expect(uploadActivityFile.mock.calls.map(([id, file]) => [id, file.name])).toEqual([
      [rows[0].id, "vuelos.pdf"],
      [rows[2].id, "coche.pdf"],
    ]);

    // The itinerary list and the map read these from the store.
    const d1 = useItineraryStore.getState().activeTrip!.days.find((d) => d.id === "d1")!;
    expect(d1.activities.map((a) => [a.origin, a.booking?.reference])).toEqual([
      ["booking", "FAKE01"],
      ["booking", "CAR42"],
    ]);
  });

  it("a failed batch keeps the review, explains the migration and can be retried", async () => {
    remote.error = { message: 'column "origin" of relation "activities" does not exist' };
    renderModal();
    await selectFiles(["coche.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));
    fireEvent.click(confirmButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/src\/lib\/booking_import_migration\.sql/);
    expect(screen.getByTestId("booking-card-bbbbbbbb-0")).toBeTruthy();
    expect(uploadActivityFile).not.toHaveBeenCalled();
    expect(useItineraryStore.getState().activeTrip!.days.flatMap((d) => d.activities)).toHaveLength(0);

    remote.error = null;
    fireEvent.click(confirmButton());
    await screen.findByText("¡Reservas en su sitio!");
    expect(uploadActivityFile).toHaveBeenCalledTimes(1);
  });

  it("generates through the existing importer with the bookings as anchors and saves only accepted proposals", async () => {
    importerResponse = {
      activities: [
        { title: "Mirador del Time (fake)", category: "sightseeing", location: "Tijarafe", date: "2031-05-11", time: "10:00", duration_minutes: 90, notes: "Comprueba el acceso" },
        { title: "Playa de Tazacorte (fake)", category: "sightseeing", date: "2031-05-11", time: "16:00", duration_minutes: 120 },
        { title: "Café junto al aeropuerto (fake)", category: "food", date: "2031-05-10", time: "07:30", duration_minutes: 60 },
      ],
      conflicts: [{ date: "2031-05-13", reason: "Día de vuelta con poco margen" }],
    };
    renderModal();
    await selectFiles(["vuelos.pdf", "coche.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));
    fireEvent.click(confirmButton());
    await screen.findByText("¡Reservas en su sitio!");

    fireEvent.click(screen.getByText("Intenso"));
    fireEvent.change(screen.getByLabelText(/¿Algo que te apetezca/), { target: { value: "miradores" } });
    fireEvent.click(screen.getByRole("button", { name: "Generar itinerario" }));
    await screen.findByText("Propuestas por día");

    // The existing text importer is reused in planning mode, fed with the saved bookings.
    const calls = fetchCalls("/api/import");
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body.text).toBeUndefined();
    expect(body.lang).toBe("es");
    expect(body.planning.request).toBe("miradores");
    expect(body.planning.context.density).toBe("full");
    const day1 = body.planning.context.days.find((d: { date: string }) => d.date === "2031-05-10");
    expect(day1.anchors.map((a: { kind: string; bookingType: string; start: string }) => [a.kind, a.bookingType, a.start])).toEqual([
      ["booking", "flight", "06:00"],
      ["booking", "car_rental", "10:00"],
    ]);

    // Valid proposals by day; the one inside the flight margin is a conflict, not acceptable.
    const day2 = screen.getByTestId("proposals-2031-05-11");
    expect(within(day2).getByDisplayValue("Mirador del Time (fake)")).toBeTruthy();
    expect(within(day2).getByText("A verificar: Comprueba el acceso")).toBeTruthy();
    expect(screen.queryByTestId("proposals-2031-05-10")).toBeNull();
    const rejected = screen.getByTestId("rejected-proposals");
    expect(within(rejected).getByText("Café junto al aeropuerto (fake)")).toBeTruthy();
    expect(rejected.textContent).toMatch(/choca con una reserva/);
    expect(rejected.textContent).toMatch(/Día de vuelta con poco margen/);

    fireEvent.click(screen.getByRole("checkbox", { name: "Aceptar Playa de Tazacorte (fake)" }));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar propuestas (1)" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(remote.inserts).toHaveLength(2);
    expect(remote.inserts[1].map((r) => [r.title, r.origin, r.day_id])).toEqual([["Mirador del Time (fake)", "suggested", "d2"]]);
    expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/Destino Tachao/), "success");
  });

  it("an infeasible trip shows alternatives without calling the importer", async () => {
    const allDay = makeActivity("all-day", { time: "09:00", durationMin: 760, origin: "manual" });
    load(makeTrip({ d1: [allDay] }, ["2031-05-10"]));
    renderModal();
    await selectFiles(["excursion.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));
    fireEvent.click(confirmButton());
    await screen.findByText("¡Reservas en su sitio!");

    fireEvent.click(screen.getByRole("button", { name: "Generar itinerario" }));
    expect(await screen.findByText("Tus días ya están completos")).toBeTruthy();
    expect(screen.getByText("Días sin hueco: 2031-05-10")).toBeTruthy();
    expect(screen.getByText(/Libera tiempo/)).toBeTruthy();
    expect(fetchCalls("/api/import")).toHaveLength(0);
  });

  it("a booking outside the trip dates cannot be confirmed until excluded", async () => {
    load(makeTrip({}, ["2031-05-10", "2031-05-11"]));
    renderModal();
    await selectFiles(["vuelos.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));

    const ret = screen.getByTestId("booking-card-aaaaaaaa-1");
    expect(within(ret).getByText(/fuera de las fechas del viaje/)).toBeTruthy();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(ret).getByRole("checkbox", { name: "Incluir" }));
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("groups the passengers of one booking into each flight and attaches every passenger's PDF", async () => {
    renderModal();
    await selectFiles(["ana.pdf", "luis.pdf", "sofia.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));

    const outbound = screen.getByTestId("booking-card-11111111-0");
    expect(within(outbound).getByText("Ana García (14C), Luis García (14D), Sofía García (14E)")).toBeTruthy();
    expect(within(screen.getByTestId("booking-card-22222222-1")).getByText(/sumamos sus pasajeros a ese vuelo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reservas (2)" }));

    await waitFor(() => expect(remote.inserts).toHaveLength(1));
    const rows = remote.inserts[0];
    expect(rows.map((r) => r.title)).toEqual(["Vuelo MAD → SPC", "Vuelo SPC → MAD"]);
    expect(String(rows[0].notes)).toContain(["Pasajeros:", "- Ana García · asiento 14C", "- Luis García · asiento 14D", "- Sofía García · asiento 14E"].join("\n"));
    await waitFor(() => expect(uploadActivityFile).toHaveBeenCalledTimes(3));
    const targets = new Set(uploadActivityFile.mock.calls.map(([activityId]) => activityId));
    expect(targets.size).toBe(1);
    expect(uploadActivityFile.mock.calls.map(([, file]) => (file as File).name)).toEqual(["ana.pdf", "luis.pdf", "sofia.pdf"]);
  });

  it("attaches a boarding pass to the flight already in the trip and adds its passenger", async () => {
    const flight = makeActivity("act-flight", {
      dayId: "d1", title: "Vuelo MAD → SPC", time: "08:00", category: "transport", origin: "booking", notes: "Localizador: XK7Q2P",
      booking: { version: 1, type: "flight", role: "departure", groupId: "g", title: "Vuelo MAD → SPC", reference: "XK7Q2P", from: "MAD", to: "SPC", start: { date: "2031-05-10", time: "08:00" }, fieldStatus: {}, passengers: [{ name: "Ana García", seat: "14C" }] },
    });
    load(makeTrip({ d1: [flight] }));
    renderModal();
    await selectFiles(["pase-luis.pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar reservas" }));
    expect(screen.getByText(/Adjuntaremos este PDF a esa reserva/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Adjuntar documentos (1)" }));

    await waitFor(() => expect(uploadActivityFile).toHaveBeenCalledWith("act-flight", expect.objectContaining({ name: "pase-luis.pdf" })));
    expect(remote.inserts).toEqual([]);
    expect(patchActivity).toHaveBeenCalledWith("d1", "act-flight", expect.objectContaining({
      booking: expect.objectContaining({ passengers: [{ name: "Ana García", seat: "14C" }, { name: "Luis García", seat: "14D" }] }),
    }));
    expect(await screen.findByText("Documentos adjuntados a reservas de tu viaje: 1.")).toBeTruthy();
  });
});
