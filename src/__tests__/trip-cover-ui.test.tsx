// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { TripPlan, TripSummary } from "@/lib/types";

const storage = vi.hoisted(() => ({
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` }, error: null as { message: string } | null })),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: storage.createSignedUrl }) },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

const { MyTrips } = await import("@/components/MyTrips");
const { TripOverview } = await import("@/components/TripOverview");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { clearTripCoverUrlCache } = await import("@/lib/trip-cover");

beforeEach(() => {
  mockMatchMedia();
  clearTripCoverUrlCache();
  storage.createSignedUrl.mockClear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(cleanup);

describe("MyTrips cover", () => {
  const summary = (id: string, name: string, extra: Partial<TripSummary> = {}): TripSummary => ({
    id, name, userId: "me", startDate: "2998-03-01", endDate: "2998-03-04", dayCount: 3, activityCount: 1, ...extra,
  });

  function renderTrips(trips: TripSummary[]) {
    useAuthStore.setState({ initialized: true, user: { id: "me", is_anonymous: false, email: "me@x.io" } as never });
    useItineraryStore.setState({
      trips, sharedTrips: [], activeTrip: null, activeTripIsDraft: false, hasFetched: true, loading: false,
      fetchSharedTrips: vi.fn(async () => {}),
    } as never);
    renderWithI18n(<MyTrips />);
  }

  it("shows the uploaded cover on the card, from a signed URL", async () => {
    renderTrips([summary("t1", "Lima", { coverPath: "t1/a.jpg" })]);
    const card = screen.getByRole("article", { name: "Lima" });
    await waitFor(() => expect(card.querySelector("img")?.getAttribute("src")).toBe("https://signed.example/t1/a.jpg"));
    expect(storage.createSignedUrl).toHaveBeenCalledWith("t1/a.jpg", 3600);
  });

  it("keeps the placeholder card when the cover cannot be signed", async () => {
    storage.createSignedUrl.mockResolvedValueOnce({ data: null as never, error: { message: "not found" } });
    renderTrips([summary("t1", "Lima", { coverPath: "t1/a.jpg" })]);
    await waitFor(() => expect(storage.createSignedUrl).toHaveBeenCalled());
    await act(async () => {});
    const card = screen.getByRole("article", { name: "Lima" });
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByText("L")).toBeTruthy();
  });

  it("renders a trip without cover as before: the initial on the gradient and no storage request", async () => {
    renderTrips([summary("t2", "Oslo")]);
    await act(async () => {});
    const card = screen.getByRole("article", { name: "Oslo" });
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByText("O")).toBeTruthy();
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("TripOverview cover controls", () => {
  const trip = (overrides: Partial<TripPlan> = {}): TripPlan => ({ ...makeTrip([]), id: "t", name: "Japan", ...overrides });
  const onChange = vi.fn<(file: File) => Promise<{ error?: string }>>(async () => ({}));
  const onRemove = vi.fn<() => Promise<{ error?: string }>>(async () => ({}));

  function renderOverview(plan: TripPlan, coverEditor?: { blocked?: "draft" | "offline" }, lang: "es" | "en" = "es") {
    return renderWithI18n(
      <TripOverview
        trip={plan}
        canShare
        onEditContext={vi.fn()}
        onShare={vi.fn()}
        coverEditor={coverEditor ? { onChange, onRemove, ...coverEditor } : undefined}
        budget={null}
        packing={null}
        shopping={null}
        tools={null}
      />,
      lang,
    );
  }

  beforeEach(() => {
    onChange.mockReset().mockResolvedValue({});
    onRemove.mockReset().mockResolvedValue({});
  });

  it("gives owners and editors change and remove controls, with an image-only file input", () => {
    renderOverview(trip({ coverPath: "t/a.jpg" }), {});
    expect(screen.getByRole("button", { name: "Cambiar portada" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar portada" })).toBeTruthy();
    const input = screen.getByLabelText("Cambiar portada", { selector: "input" }) as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
  });

  it("uses English labels in English", () => {
    renderOverview(trip({ coverPath: "t/a.jpg" }), {}, "en");
    expect(screen.getByRole("button", { name: "Change cover" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove cover" })).toBeTruthy();
  });

  it("shows no cover controls to viewers, and no remove control without a cover", () => {
    renderOverview(trip({ coverPath: "t/a.jpg" }));
    expect(screen.queryByRole("button", { name: "Cambiar portada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar portada" })).toBeNull();
    cleanup();
    renderOverview(trip(), {});
    expect(screen.getByRole("button", { name: "Cambiar portada" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quitar portada" })).toBeNull();
  });

  it("uploads the chosen file and shows why it failed", async () => {
    renderOverview(trip(), {});
    const input = screen.getByLabelText("Cambiar portada", { selector: "input" });
    const file = new File(["x"], "a.png", { type: "image/png" });

    for (const [error, message] of [
      ["size", "La imagen supera los 5 MB."],
      ["type", "Usa una imagen JPEG, PNG o WebP."],
      ["upload", "No se pudo subir la portada. Inténtalo de nuevo."],
      ["unavailable", "Las portadas todavía no están disponibles en este servidor."],
    ]) {
      onChange.mockResolvedValueOnce({ error });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });
      expect(screen.getByRole("alert").textContent).toBe(message);
    }
    expect(onChange).toHaveBeenLastCalledWith(file);
  });

  it("removes the cover", async () => {
    renderOverview(trip({ coverPath: "t/a.jpg" }), {});
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Quitar portada" }));
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("explains that drafts and offline trips cannot change the cover", () => {
    renderOverview(trip(), { blocked: "draft" });
    expect((screen.getByRole("button", { name: "Cambiar portada" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Guarda el viaje para añadir una portada.")).toBeTruthy();
    cleanup();
    renderOverview(trip(), { blocked: "offline" });
    expect((screen.getByRole("button", { name: "Cambiar portada" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Conéctate a internet para cambiar la portada.")).toBeTruthy();
  });

  it("shows the uploaded cover in the summary header", async () => {
    renderOverview(trip({ coverPath: "t/a.jpg" }));
    await waitFor(() => expect(document.querySelector("img")?.getAttribute("src")).toBe("https://signed.example/t/a.jpg"));
  });
});
