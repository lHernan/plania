// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { Memory, TripMember } from "@/lib/types";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "offline" } }) }) },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

const { MemoryEditor } = await import("@/components/memories/MemoryEditor");
const { MemoryCard } = await import("@/components/memories/MemoryCard");
const { clearTripMembersCache } = await import("@/components/memories/use-trip-members");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const members: TripMember[] = [
  { userId: "owner", email: "ana@x.io", isOwner: true },
  { userId: "me", email: "me@x.io", isOwner: false },
  { userId: "u3", email: "luis@x.io", isOwner: false },
];

const memory = (overrides: Partial<Memory> = {}): Memory => ({
  id: "m1",
  tripId: "t",
  activityId: "a1",
  authorId: "me",
  note: "Great sunset",
  rating: 4,
  audience: "trip",
  audienceUserIds: [],
  photos: [{ id: "p1", memoryId: "m1", tripId: "t", path: "t/m1/p1.webp", caption: null, sortOrder: 0 }],
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...overrides,
});

const actions = {
  loadTripMembers: vi.fn(async () => ({ members })),
  createMemory: vi.fn<(input: unknown) => Promise<{ error?: string; memoryId?: string; failedPhotos?: number[] }>>(async () => ({ memoryId: "new", failedPhotos: [] })),
  updateMemory: vi.fn(async () => ({})),
  deleteMemory: vi.fn(async () => ({})),
  addMemoryPhotos: vi.fn(async (): Promise<{ error?: string; failedPhotos?: number[] }> => ({ failedPhotos: [] })),
  removeMemoryPhoto: vi.fn(async () => ({})),
  setMemoryAudience: vi.fn(async () => ({})),
};

const onClose = vi.fn();

async function renderEditor(props: { memory?: Memory; activityId?: string | null } = {}) {
  renderWithI18n(<MemoryEditor tripId="t" activityId={props.activityId ?? "a1"} currentUserId="me" memory={props.memory} onClose={onClose} />);
  await act(async () => {});
}

beforeEach(() => {
  mockMatchMedia();
  window.localStorage.clear();
  clearTripMembersCache();
  Object.values(actions).forEach((action) => action.mockClear());
  onClose.mockClear();
  useItineraryStore.setState({ ...actions, activeTrip: null } as never);
  useAuthStore.setState({ user: null } as never);
});
afterEach(cleanup);

describe("probe T2", () => {
  it("a failed create does not remember the audience choice", async () => {
    actions.createMemory.mockResolvedValueOnce({ error: "failed" });
    await renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Solo algunas personas" }));
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    await waitFor(() => expect(actions.createMemory).toHaveBeenCalled());
    await act(async () => {});
    expect(onClose).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("plania_memory_audience_t")).toBeNull();
  });
  it("a failed audience change on edit does not remember the choice", async () => {
    actions.setMemoryAudience.mockResolvedValueOnce({ error: "failed" } as never);
    await renderEditor({ memory: memory() });
    fireEvent.click(screen.getByRole("radio", { name: "Solo algunas personas" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(actions.setMemoryAudience).toHaveBeenCalled());
    await act(async () => {});
    expect(window.localStorage.getItem("plania_memory_audience_t")).toBeNull();
  });
  it("'Yo' is checked and cannot be unchecked; me is never sent in audience ids", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Solo algunas personas" }));
    await act(async () => {});
    const me = screen.getByRole("checkbox", { name: "Yo" }) as HTMLInputElement;
    expect(me.checked).toBe(true);
    expect(me.disabled).toBe(true);
    const labels = screen.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent);
    expect(labels.join("|")).not.toContain("me@x.io");
    fireEvent.click(screen.getByRole("checkbox", { name: /luis@x.io/ }));
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    await waitFor(() => expect(actions.createMemory).toHaveBeenCalled());
    expect((actions.createMemory.mock.calls[0][0] as { audienceUserIds: string[] }).audienceUserIds).toEqual(["u3"]);
  });
  it("non-author card has no edit button", () => {
    renderWithI18n(<MemoryCard memory={memory({ authorId: "u3" })} currentUserId="me" members={members} onEdit={() => {}} />);
    expect(screen.queryByRole("button", { name: /editar/i })).toBeNull();
  });
});
