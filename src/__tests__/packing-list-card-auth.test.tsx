// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
  },
}));

const { PackingListCard } = await import("@/components/PackingListCard");
const { useAuthStore } = await import("@/store/use-auth-store");

const days = [{ id: "d1", date: "2026-11-15", city: "Madrid", label: "1", activities: [], userId: "u" }];
const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith("/api/weather")) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify({ categories: [{ name: "Ropa", items: [] }] }), { status: 200 });
});

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openAndGenerate(onRequireAuth = vi.fn()) {
  renderWithI18n(<PackingListCard tripId="t1" tripName="Madrid" days={days} onRequireAuth={onRequireAuth} />);
  fireEvent.click(screen.getByRole("button", { name: /Lista de equipaje inteligente/ }));
  fireEvent.click(screen.getByRole("button", { name: "Generar lista de equipaje" }));
  return onRequireAuth;
}

describe("PackingListCard generation needs an account", () => {
  it("asks an anonymous guest to sign in and never calls the AI", async () => {
    useAuthStore.setState({ user: { id: "anon", is_anonymous: true } as never });
    const onRequireAuth = openAndGenerate();
    expect(onRequireAuth).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/packing-list")).toBe(false);
  });

  it("sends the session token for a registered user", async () => {
    useAuthStore.setState({ user: { id: "u1", is_anonymous: false } as never });
    const onRequireAuth = openAndGenerate();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/packing-list")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/packing-list") as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(onRequireAuth).not.toHaveBeenCalled();
  });
});
