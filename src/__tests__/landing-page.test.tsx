// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: db.from,
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
    },
  },
}));

const { default: Home } = await import("@/app/page");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { TRIP_TEMPLATES } = await import("@/lib/trip-templates");

const createTrip = vi.fn(async () => {});

function seed(who: "guest" | "registered") {
  useItineraryStore.setState({
    activeTrip: null,
    activeTripIsDraft: false,
    loading: false,
    hasFetched: true,
    createTrip,
  } as never);
  useAuthStore.setState({
    user: who === "guest" ? { id: "anon", is_anonymous: true } : { id: "me", is_anonymous: false, email: "me@x.io" },
  } as never);
}

async function renderHome(who: "guest" | "registered" = "guest") {
  seed(who);
  renderWithI18n(<Home />);
  await act(async () => {});
}

beforeEach(() => {
  mockMatchMedia();
  nav.push.mockReset();
  createTrip.mockClear();
  db.from.mockReset();
});

afterEach(() => cleanup());

describe("landing for visitors", () => {
  it("shows the claim, the planning field and the templates", async () => {
    await renderHome();
    expect(screen.getByText("Destino Tachao, recuerdos que quedan")).toBeTruthy();
    expect(screen.getByLabelText("¿A dónde vas?")).toBeTruthy();
    expect(screen.getByText("Planifica con IA")).toBeTruthy();
    expect(screen.getByText("Todo tu viaje en un sitio")).toBeTruthy();
    expect(screen.getByText("Vívelo y táchalo")).toBeTruthy();
    expect(screen.getAllByText("¡Pregúntale a Tachi!").length).toBeGreaterThan(0);
    expect(screen.getByText(TRIP_TEMPLATES[0].name)).toBeTruthy();
  });

  it("the planning field opens the planner with the destination and dates filled in", async () => {
    await renderHome();
    fireEvent.change(screen.getByLabelText("¿A dónde vas?"), { target: { value: "Kioto" } });
    fireEvent.change(screen.getByLabelText("Fecha de inicio"), { target: { value: "2027-04-01" } });
    fireEvent.change(screen.getByLabelText("Fecha de fin"), { target: { value: "2027-04-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Empezar a planificar" }));
    expect(nav.push).toHaveBeenCalledWith("/plan?dest=Kioto&start=2027-04-01&end=2027-04-05");
  });

  it("the planning field can ask for a number of days instead of dates", async () => {
    await renderHome();
    fireEvent.change(screen.getByLabelText("¿A dónde vas?"), { target: { value: "Lisboa" } });
    fireEvent.click(screen.getByRole("button", { name: "Por días" }));
    fireEvent.change(screen.getByLabelText("Nº de días"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Empezar a planificar" }));
    expect(nav.push).toHaveBeenCalledWith("/plan?dest=Lisboa&days=4");
  });

  it("a template opens as a draft", async () => {
    await renderHome();
    fireEvent.click(screen.getAllByRole("button", { name: "Usar como plantilla" })[0]);
    const state = useItineraryStore.getState();
    expect(state.activeTripIsDraft).toBe(true);
    expect(state.activeTrip?.name).toBe(TRIP_TEMPLATES[0].plan.name);
  });
});

describe("create from scratch", () => {
  function quickStart(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Crear desde cero" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByPlaceholderText("Ej. Mi escapada a Japon 2026"), { target: { value: name } });
    fireEvent.change(dialog.getByLabelText("Fecha de inicio"), { target: { value: "2027-05-10" } });
    fireEvent.change(dialog.getByLabelText("Fecha de fin"), { target: { value: "2027-05-12" } });
    fireEvent.click(dialog.getByRole("button", { name: "Crear aventura" }));
  }

  it("for a visitor becomes a draft, without writing to the database", async () => {
    await renderHome("guest");
    quickStart("Roma");
    expect(createTrip).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
    const { activeTrip, activeTripIsDraft } = useItineraryStore.getState();
    expect(activeTripIsDraft).toBe(true);
    expect(activeTrip?.name).toBe("Roma");
    expect(activeTrip?.days.map((d) => d.date)).toEqual(["2027-05-10", "2027-05-11", "2027-05-12"]);
  });

  it("for a registered user still creates a real trip", async () => {
    await renderHome("registered");
    quickStart("Roma");
    expect(createTrip).toHaveBeenCalledWith("Roma", "2027-05-10", "2027-05-12");
    expect(useItineraryStore.getState().activeTripIsDraft).toBe(false);
  });
});
