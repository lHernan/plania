// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { addDays, format } from "date-fns";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/plan",
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const auth = vi.hoisted(() => ({ token: null as string | null, from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: auth.from,
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: auth.token ? { access_token: auth.token } : null } }),
      getUser: async () => ({ data: { user: null } }),
    },
  },
}));

const { Planner } = await import("@/components/planner/Planner");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const saveDraft = vi.fn(async () => {
  const trip = useItineraryStore.getState().activeTrip!;
  useItineraryStore.setState({ activeTrip: { ...trip, id: "new-1" }, activeTripIsDraft: false } as never);
  return {};
});

const PROPOSALS = {
  activities: [{ title: "Fushimi Inari", date: "2027-04-01", time: "10:00", duration_minutes: 90, category: "sightseeing" }],
};

function signedIn(registered: boolean) {
  auth.token = registered ? "tok" : null;
  useAuthStore.setState({
    user: registered ? { id: "me", is_anonymous: false, email: "me@x.io" } : { id: "anon", is_anonymous: true },
  } as never);
}

async function renderPlanner(params: Record<string, string> = {}) {
  nav.params = new URLSearchParams(params);
  renderWithI18n(<Planner />);
  await act(async () => {});
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
}

const KYOTO = { dest: "Kioto", start: "2027-04-01", end: "2027-04-03" };

beforeEach(() => {
  mockMatchMedia();
  window.sessionStorage.clear();
  nav.push.mockReset();
  auth.from.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(PROPOSALS), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  saveDraft.mockClear();
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false, loading: false, hasFetched: true, saveDraft } as never);
  signedIn(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("planner for a visitor", () => {
  it("starts from the values the landing passed and creates a draft day by day", async () => {
    await renderPlanner(KYOTO);
    expect((screen.getByLabelText("¿A dónde vas?") as HTMLInputElement).value).toBe("Kioto");
    next();
    fireEvent.click(screen.getByRole("radio", { name: "Económico" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Caminar poco" }));
    next();
    const preview = within(screen.getByTestId("planner-preview"));
    expect(preview.getByText("Día 1")).toBeTruthy();
    expect(preview.getByText("Día 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }));

    const { activeTrip, activeTripIsDraft } = useItineraryStore.getState();
    expect(activeTripIsDraft).toBe(true);
    expect(activeTrip?.name).toBe("Kioto");
    expect(activeTrip?.days.map((d) => [d.date, d.city])).toEqual([
      ["2027-04-01", "Kioto"],
      ["2027-04-02", "Kioto"],
      ["2027-04-03", "Kioto"],
    ]);
    expect(activeTrip?.travelContext?.preferences).toEqual({ budgetLevel: "low", minimizeWalking: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.from).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith(`/trips/${encodeURIComponent(activeTrip!.id)}`);
  });

  it("plans by number of days when there are no dates", async () => {
    await renderPlanner();
    fireEvent.change(screen.getByLabelText("¿A dónde vas?"), { target: { value: "Lisboa, Oporto" } });
    fireEvent.click(screen.getByRole("button", { name: "Por días" }));
    fireEvent.change(screen.getByLabelText("Nº de días"), { target: { value: "4" } });
    next();
    next();
    expect(within(screen.getByTestId("planner-preview")).getByText("Día 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }));

    const today = new Date();
    const { activeTrip } = useItineraryStore.getState();
    expect(activeTrip?.days.map((d) => d.date)).toEqual([0, 1, 2, 3].map((n) => format(addDays(today, n), "yyyy-MM-dd")));
    expect(activeTrip?.days.map((d) => d.city)).toEqual(["Lisboa", "Lisboa", "Oporto", "Oporto"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Generar con Tachi asks for an account with the Tachi copy and calls no AI", async () => {
    await renderPlanner(KYOTO);
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Generar con Tachi" }));
    expect(screen.getByText("Tachi es para usuarios registrados. Inicia sesión y seguiremos donde lo dejaste.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the form through the sign-in and then generates with it", async () => {
    await renderPlanner(KYOTO);
    next();
    fireEvent.click(screen.getByRole("radio", { name: "Intenso" }));
    next();
    fireEvent.click(screen.getByRole("button", { name: "Generar con Tachi" }));
    expect(fetchMock).not.toHaveBeenCalled();

    // The visitor signs in (possibly on a reload): the planner comes back with the same data.
    cleanup();
    signedIn(true);
    await renderPlanner();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/import");
    const body = JSON.parse(String(init?.body));
    expect(body.planning.context.tripName).toBe("Kioto");
    expect(body.planning.context.density).toBe("full");
    expect(body.planning.context.days.map((d: { date: string }) => d.date)).toEqual(["2027-04-01", "2027-04-02", "2027-04-03"]);
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
  });
});

describe("planner for a registered user", () => {
  it("generates with Tachi through the planning request and creates the trip", async () => {
    signedIn(true);
    await renderPlanner(KYOTO);
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Generar con Tachi" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/import");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(String(init?.body));
    expect(body.lang).toBe("es");
    expect(body.planning.context.days).toHaveLength(3);
    expect(body.planning.context.days[0].city).toBe("Kioto");

    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Crear viaje" }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/trips/new-1"));
    const day1 = useItineraryStore.getState().activeTrip?.days[0];
    expect(day1?.activities.map((a) => [a.title, a.time, a.origin])).toEqual([["Fushimi Inari", "10:00", "suggested"]]);
  });

  it("shows a message and a retry when the model does not answer in time", async () => {
    signedIn(true);
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "timeout" }), { status: 500 }));
    await renderPlanner(KYOTO);
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Generar con Tachi" }));

    expect(await screen.findByText("Tachi no ha podido responder a tiempo. Inténtalo de nuevo.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Fushimi Inari")).toBeTruthy();
  });
});
