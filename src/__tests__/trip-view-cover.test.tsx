// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { PackingRole } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/t/overview",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    storage: {
      from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://cdn.test/${path}` }, error: null }) }),
    },
  },
}));
// Leaves that talk to the network or the browser; not what this test is about.
vi.mock("@/components/CriticalReservationsPanel", () => ({ CriticalReservationsPanel: () => null }));
vi.mock("@/components/ShoppingListPanel", () => ({ ShoppingListPanel: () => null }));
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => null }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => null }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => null }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => null }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView } = await import("@/components/TripView");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

async function renderTrip({
  ownerId = "me",
  role,
  draft = false,
  coverPath = "t/a.jpg",
}: { ownerId?: string; role?: PackingRole; draft?: boolean; coverPath?: string | null } = {}) {
  const trip = {
    ...makeTrip([makeDay("d1", [])]),
    id: "t",
    name: "Lisboa",
    userId: ownerId,
    coverPath,
    ...(role ? { packing: { items: [], remote: true, role } } : {}),
  };
  useItineraryStore.setState({
    activeTrip: trip,
    activeTripIsDraft: draft,
    activeDayId: "d1",
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
  } as never);
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "me@x.io" } } as never);
  renderWithI18n(<TripView />);
  await act(async () => {});
}

beforeEach(() => {
  mockMatchMedia();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TripView cover controls", () => {
  it("are there for the owner", async () => {
    await renderTrip();
    expect(screen.getByRole("button", { name: "Cambiar portada" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar portada" })).toBeTruthy();
  });

  it("are there for an editor of someone else's trip", async () => {
    await renderTrip({ ownerId: "owner", role: "editor" });
    expect(screen.getByRole("button", { name: "Cambiar portada" })).toBeTruthy();
  });

  it("are not there for a viewer", async () => {
    await renderTrip({ ownerId: "owner", role: "viewer" });
    expect(screen.queryByRole("button", { name: "Cambiar portada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar portada" })).toBeNull();
  });

  it("are disabled with the reason on a draft", async () => {
    await renderTrip({ draft: true });
    expect((screen.getByRole("button", { name: "Cambiar portada" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Guarda el viaje para añadir una portada.")).toBeTruthy();
  });
});

describe("TripView header cover", () => {
  it("shows the trip cover behind the header", async () => {
    await renderTrip({ coverPath: "t/header.jpg" });
    const header = screen.getByRole("banner");
    await waitFor(() => expect(within(header).getByTestId("trip-header-cover").querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/t/header.jpg"));
  });

  it("spans the whole header (top bar, tabs and day strip), not only the top bar", async () => {
    await renderTrip({ coverPath: "t/header.jpg" });
    const header = screen.getByRole("banner");
    expect(within(header).getByTestId("trip-header-cover").parentElement).toBe(header);
    expect(header.className).toContain("isolate");
  });

  it("puts the trip name, the account controls and the section tabs on their own surface over the photo", async () => {
    await renderTrip({ coverPath: "t/header.jpg" });
    const header = screen.getByRole("banner");
    const surfaces = header.querySelectorAll("[data-over-cover]");
    expect(surfaces).toHaveLength(2);
    expect(within(header.querySelector('[data-over-cover="controls"]') as HTMLElement).getByRole("button", { name: "Menú de la cuenta" })).toBeTruthy();
    surfaces.forEach((surface) => expect(surface.className).toContain("backdrop-blur"));
  });

  it("shows each section tab as its own pill over the photo instead of a band", async () => {
    await renderTrip({ coverPath: "t/header.jpg" });
    const tabs = within(within(screen.getByRole("banner")).getByRole("navigation", { name: "Secciones del viaje" })).getAllByRole("link");
    expect(tabs).toHaveLength(5);
    tabs.forEach((tab) => expect(tab.className).toMatch(/rounded-full[\s\S]*backdrop-blur/));
  });

  it("keeps the account menu above the day strip over the photo", async () => {
    await renderTrip({ coverPath: "t/header.jpg" });
    const controls = screen.getByRole("banner").querySelector('[data-over-cover="controls"]') as HTMLElement;
    expect(controls.className).toMatch(/\brelative\b/);
    expect(controls.className).toMatch(/\bz-20\b/);
  });

  it("keeps the plain header when the trip has no cover", async () => {
    await renderTrip({ coverPath: null });
    const header = screen.getByRole("banner");
    expect(within(header).queryByTestId("trip-header-cover")).toBeNull();
    expect(header.querySelectorAll("[data-over-cover]")).toHaveLength(0);
    within(within(screen.getByRole("banner")).getByRole("navigation", { name: "Secciones del viaje" }))
      .getAllByRole("link")
      .forEach((tab) => expect(tab.className).not.toContain("backdrop-blur"));
  });
});
