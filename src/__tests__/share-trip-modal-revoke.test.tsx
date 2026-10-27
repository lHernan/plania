// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
  },
}));

const { ShareTripModal } = await import("@/components/ShareTripModal");

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/trips/t1/shares") {
    return new Response(JSON.stringify({ shares: [{ userId: "u2", email: "ana@test.com", role: "viewer", createdAt: "2026-10-20T00:00:00Z" }] }));
  }
  if (url === "/api/trips/t1/shares/u2" && init?.method === "DELETE") return new Response("{}");
  return new Response("{}");
});

const deletes = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShareTripModal revoke", () => {
  it("asks inside the list before removing access, never with a browser dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderWithI18n(<ShareTripModal tripId="t1" tripName="La Palma" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revocar acceso de ana@test.com?" }));

    expect(screen.getByText("¿Quitar el acceso de ana@test.com?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("¿Quitar el acceso de ana@test.com?")).toBeNull();
    expect(deletes()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Revocar acceso de ana@test.com?" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar acceso" }));
    await waitFor(() => expect(screen.queryByText("ana@test.com")).toBeNull());
    expect(deletes()).toHaveLength(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
