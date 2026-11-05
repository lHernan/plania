// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";

vi.mock("next/navigation", () => ({ useParams: () => ({ token: "tok" }), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/share/tok" }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({}), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } },
}));

const { default: SharePage } = await import("@/app/share/[token]/page");
const { useAuthStore } = await import("@/store/use-auth-store");

const days = [
  { id: "d1", date: "2026-11-05", city: "Funchal", label: "" },
  { id: "d2", date: "2026-11-06", city: "Porto Moniz", label: "" },
];
const activities = [
  { id: "a1", day_id: "d1", title: "Levada do Rei", time: "09:00", state: "completed" },
  { id: "a2", day_id: "d1", title: "Mercado", time: "12:00", state: "pending" },
  { id: "a3", day_id: "d2", title: "Piscinas", time: "10:00", state: "pending" },
];
const memories = [
  { id: "m-trip", activityId: null, note: "Un viaje redondo", rating: 5, createdAt: "2026-11-06T20:00:00Z", photos: [] },
  { id: "m-a1", activityId: "a1", note: "Cascadas", rating: 4, createdAt: "2026-11-05T10:00:00Z", photos: [{ id: "p1", url: "https://signed/p1", caption: "La cascada" }] },
];

const serve = (trip: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/share/tok") return new Response(JSON.stringify({ tripId: "t1", tripName: "Madeira", role: "viewer", email: null, accepted: false }));
      if (url === "/api/share/tok/trip")
        return new Response(JSON.stringify({ trip: { id: "t1", name: "Madeira", startDate: "2026-11-05", endDate: "2026-11-06" }, role: "viewer", days, activities, reservations: [], ...trip }));
      throw new Error(url);
    }),
  );

beforeEach(() => useAuthStore.setState({ user: null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("share page: the trip's story", () => {
  it("is not shown without public memories, and the page renders as before", async () => {
    serve({});
    const { container } = renderWithI18n(<SharePage />);
    expect(await screen.findByText("2026-11-05 · Funchal")).toBeTruthy();
    expect(screen.queryByText("La historia del viaje")).toBeNull();
    expect(container.querySelectorAll("section")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("shows trip memories first, then each day with its completed activities and their memories", async () => {
    serve({ memories });
    renderWithI18n(<SharePage />);
    const story = (await screen.findByText("La historia del viaje")).closest("section")!;
    const text = story.textContent ?? "";
    expect(text.indexOf("Un viaje redondo")).toBeLessThan(text.indexOf("Levada do Rei"));
    expect(within(story).getByText("Cascadas")).toBeTruthy();
    expect(within(story).getByRole("img", { name: "La cascada" }).getAttribute("src")).toBe("https://signed/p1");
    expect(within(story).getByRole("img", { name: "Valoración: 4 de 5" })).toBeTruthy();
    // Activities that were not completed and have no memory stay out of the story.
    expect(within(story).queryByText("Mercado")).toBeNull();
    expect(within(story).queryByText("Piscinas")).toBeNull();
  });
});
