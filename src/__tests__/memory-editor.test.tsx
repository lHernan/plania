// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

const photo = (name: string) => new File(["x"], name, { type: "image/jpeg" });

beforeEach(() => {
  mockMatchMedia();
  window.localStorage.clear();
  clearTripMembersCache();
  Object.values(actions).forEach((action) => action.mockClear());
  onClose.mockClear();
  useItineraryStore.setState({ ...actions, activeTrip: null } as never);
});
afterEach(cleanup);

describe("MemoryEditor", () => {
  it("defaults the audience to the last choice for the trip and saves the choice on submit", async () => {
    window.localStorage.setItem("plania_memory_audience_t", "selected");
    await renderEditor();
    expect((screen.getByRole("radio", { name: "Solo algunas personas" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Todo el viaje" }));
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(window.localStorage.getItem("plania_memory_audience_t")).toBe("trip");
  });

  it("defaults to the whole trip without a remembered choice", async () => {
    await renderEditor();
    expect((screen.getByRole("radio", { name: "Todo el viaje" }) as HTMLInputElement).checked).toBe(true);
  });

  it("lists the trip members for 'Solo algunas personas', with me fixed, and sends the chosen ids", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Solo algunas personas" }));
    const list = await screen.findByRole("group", { name: "Personas que lo ven" });
    const me = within(list).getByRole("checkbox", { name: "Yo" }) as HTMLInputElement;
    expect(me.checked).toBe(true);
    expect(me.disabled).toBe(true);
    expect(within(list).getByRole("checkbox", { name: /ana@x\.io/ }).closest("label")?.textContent).toContain("Creador del viaje");
    expect(within(list).queryByRole("checkbox", { name: "me@x.io" })).toBeNull();
    fireEvent.click(within(list).getByRole("checkbox", { name: "luis@x.io" }));
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Just us" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    await waitFor(() => expect(actions.createMemory).toHaveBeenCalled());
    expect(actions.createMemory.mock.calls[0][0]).toMatchObject({ audience: "selected", audienceUserIds: ["u3"] });
  });

  it("creates the memory with its note, rating, photos and activity", async () => {
    await renderEditor();
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Best ramen" } });
    fireEvent.click(screen.getByRole("radio", { name: "5 de 5" }));
    const files = [photo("a.jpg"), photo("b.jpg")];
    fireEvent.change(screen.getByLabelText("Añadir fotos"), { target: { files } });
    expect(screen.getAllByRole("button", { name: /^Quitar foto/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Quitar foto 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    await waitFor(() => expect(actions.createMemory).toHaveBeenCalledTimes(1));
    expect(actions.createMemory.mock.calls[0][0]).toEqual({
      activityId: "a1",
      note: "Best ramen",
      rating: 5,
      audience: "trip",
      audienceUserIds: [],
      photos: [files[0]],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("asks for something to remember before saving an empty memory", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Escribe una nota, valora o añade una foto.");
    expect(actions.createMemory).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", "Guarda el viaje para crear recuerdos"],
    ["offline", "Sin conexión: los recuerdos se guardan con internet"],
    ["forbidden", "No puedes cambiar este recuerdo."],
    ["invalid", "Revisa la nota y la valoración."],
    ["unavailable", "Los recuerdos todavía no están disponibles en este servidor."],
    ["failed", "No se pudo guardar el recuerdo. Inténtalo de nuevo."],
  ])("shows the %s error", async (code, message) => {
    actions.createMemory.mockResolvedValueOnce({ error: code });
    await renderEditor();
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports photos that failed, keeps them to retry, and retries them on the saved memory", async () => {
    actions.createMemory.mockResolvedValueOnce({ memoryId: "new", failedPhotos: [1] });
    useItineraryStore.setState({ activeTrip: { id: "t", memories: [memory({ id: "new", photos: [], note: null, rating: null })] } } as never);
    await renderEditor();
    const files = [photo("a.jpg"), photo("b.jpg")];
    fireEvent.change(screen.getByLabelText("Añadir fotos"), { target: { files } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("1 foto(s) no se pudieron subir. Guarda de nuevo para reintentarlo.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /^Quitar foto/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    await waitFor(() => expect(actions.addMemoryPhotos).toHaveBeenCalledWith("new", [files[1]]));
    expect(actions.createMemory).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("edits the author's memory prefilled and saves only what changed", async () => {
    await renderEditor({ memory: memory() });
    expect(screen.getByRole("heading", { name: "Editar recuerdo" })).toBeTruthy();
    expect((screen.getByLabelText("Nota") as HTMLTextAreaElement).value).toBe("Great sunset");
    expect((screen.getByRole("radio", { name: "4 de 5" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Nota"), { target: { value: "Greatest sunset" } });
    fireEvent.click(screen.getByRole("button", { name: "Quitar foto 1" }));
    fireEvent.click(screen.getByRole("radio", { name: "Solo algunas personas" }));
    const list = await screen.findByRole("group", { name: "Personas que lo ven" });
    fireEvent.click(within(list).getByRole("checkbox", { name: /ana@x\.io/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar recuerdo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(actions.updateMemory).toHaveBeenCalledWith("m1", { note: "Greatest sunset", rating: 4 });
    expect(actions.removeMemoryPhoto).toHaveBeenCalledWith("m1", "p1");
    expect(actions.setMemoryAudience).toHaveBeenCalledWith("m1", "selected", ["owner"]);
    expect(actions.createMemory).not.toHaveBeenCalled();
  });

  it("deletes the memory after confirming", async () => {
    await renderEditor({ memory: memory() });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar recuerdo" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("¿Eliminar este recuerdo y sus fotos?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(actions.deleteMemory).toHaveBeenCalledWith("m1"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("MemoryCard", () => {
  it("shows the note, the rating and 'Tú' as author, with an edit button for the author", async () => {
    const onEdit = vi.fn();
    renderWithI18n(<MemoryCard memory={memory()} currentUserId="me" members={members} onEdit={onEdit} />);
    expect(screen.getByText("Great sunset")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Valoración: 4 de 5" })).toBeTruthy();
    expect(screen.getByText("Tú")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Editar recuerdo" }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("is read-only for someone who is not the author, who sees the author's email", () => {
    renderWithI18n(<MemoryCard memory={memory({ authorId: "owner" })} currentUserId="me" members={members} onEdit={vi.fn()} />);
    expect(screen.getByText("ana@x.io")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar recuerdo" })).toBeNull();
  });

  it("says who sees a memory shared with some people", () => {
    renderWithI18n(<MemoryCard memory={memory({ audience: "selected", audienceUserIds: ["u3"] })} currentUserId="me" members={members} />);
    expect(screen.getByText("Solo: Tú, luis@x.io")).toBeTruthy();
  });

  it("shows no audience note for a memory of the whole trip", () => {
    renderWithI18n(<MemoryCard memory={memory()} currentUserId="me" members={members} />);
    expect(screen.queryByText(/^Solo:/)).toBeNull();
  });
});
