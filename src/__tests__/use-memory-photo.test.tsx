// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const client = vi.hoisted(() => ({
  loaded: vi.fn(),
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.example/${path}` } as { signedUrl: string } | null, error: null as { message: string } | null })),
}));

// The factory runs only when the module is first imported: `loaded` proves the lazy import.
vi.mock("@/lib/supabase", () => {
  client.loaded();
  return { supabase: { storage: { from: () => ({ createSignedUrl: client.createSignedUrl }) } } };
});

const { useMemoryPhotoUrl } = await import("@/hooks/use-memory-photo");
const { MemoryPhotoImage } = await import("@/components/memories/MemoryPhotoImage");
const { clearMemoryPhotoUrlCache } = await import("@/lib/memory-photos");

beforeEach(() => {
  clearMemoryPhotoUrlCache();
  client.createSignedUrl.mockClear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(cleanup);

describe("memory photo URL", () => {
  it("does not load the Supabase client when there is no photo", async () => {
    const { result } = renderHook(() => useMemoryPhotoUrl(null));
    await Promise.resolve();
    expect(result.current).toBeNull();
    expect(client.loaded).not.toHaveBeenCalled();
  });

  it("loads the client and signs the photo when there is one", async () => {
    const { result } = renderHook(() => useMemoryPhotoUrl("t/m/p.webp"));
    await waitFor(() => expect(result.current).toBe("https://signed.example/t/m/p.webp"));
    expect(client.loaded).toHaveBeenCalledTimes(1);
  });

  it("answers null when the URL cannot be signed", async () => {
    client.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    const { result } = renderHook(() => useMemoryPhotoUrl("t/m/denied.webp"));
    await waitFor(() => expect(client.createSignedUrl).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBeNull();
  });

  it("shows a placeholder when the image fails to load", async () => {
    render(<MemoryPhotoImage path="t/m/broken.webp" alt="Foto 1" placeholderLabel="Foto no disponible" />);
    const img = await screen.findByRole("img", { name: "Foto 1" });
    fireEvent.error(img);
    expect(screen.queryByRole("img", { name: "Foto 1" })).toBeNull();
    expect(screen.getByLabelText("Foto no disponible")).toBeTruthy();
  });
});
