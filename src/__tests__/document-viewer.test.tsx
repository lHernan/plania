// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";
import type { ActivityFile } from "@/lib/types";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({}), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } },
}));

const docs = vi.hoisted(() => ({
  pages: 2,
  codes: [] as { page: number; kind: "qr" | "barcode"; value: string }[],
  crops: [] as { page: number; kind: string }[],
}));

vi.mock("@/lib/documents/render", () => {
  const fakeCanvas = (label: string) => ({ width: 800, height: 1100, toDataURL: (type?: string) => `data:${type ?? "image/png"};base64,${label}` });
  return {
    loadDocument: vi.fn(async () =>
      Array.from({ length: docs.pages }, (_, index) => ({ index, width: 595, height: 842, render: async () => fakeCanvas(`page${index + 1}`) })),
    ),
    DETECTION_SIDES_PX: [1200, 2400],
    // The page index travels in the image so the codes mock knows which page it looks at.
    pageImage: vi.fn(async (page: { index: number }) => ({ data: new Uint8ClampedArray(4), width: page.index, height: 1 })),
    renderCrop: vi.fn(async (_page: unknown, _box: unknown, kind: string) => {
      docs.crops.push({ page: 0, kind });
      return `data:image/png;base64,crop-${kind}`;
    }),
  };
});

vi.mock("@/lib/documents/codes", () => {
  return {
    detectCodes: vi.fn(async (image: { width: number }) => {
      const page = image.width;
      return docs.codes
        .filter((code) => code.page === page)
        .map((code) => ({ kind: code.kind, format: code.kind === "qr" ? "qr_code" : "ean_13", value: code.value, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 } }));
    }),
    resetCalls: () => undefined,
  };
});

vi.mock("@/lib/offline-documents", () => ({
  cacheDocumentForOffline: vi.fn(async () => true),
  getCachedDocumentAvailability: vi.fn(async () => false),
  getCachedDocumentBlobUrl: vi.fn(async () => null),
  openDocumentInNewTab: vi.fn(),
}));

// jsdom has no PointerEvent: a MouseEvent with a pointerId carries the coordinates.
if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  } as unknown as typeof PointerEvent;
}

const codesModule = (await import("@/lib/documents/codes")) as unknown as { resetCalls: () => void };
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { DocumentViewer } = await import("@/components/DocumentViewer");

const file: ActivityFile = { id: "f1", activityId: "a1", fileUrl: "https://x.test/object/public/activity-files/boarding.pdf", fileType: "pdf", fileName: "boarding.pdf" } as ActivityFile;
const setFileFocusArea = vi.fn(async () => {});
const onClose = vi.fn();
const onDelete = vi.fn();
const release = vi.fn(async () => {});
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ regions: [{ type: "qr", x: 50, y: 30, width: 20, height: 20, label: "QR" }] })));

beforeEach(() => {
  docs.pages = 2;
  docs.codes = [];
  docs.crops = [];
  codesModule.resetCalls();
  for (const m of [setFileFocusArea, onClose, onDelete, release, fetchMock]) m.mockClear();
  useItineraryStore.setState({ setFileFocusArea });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  Object.defineProperty(navigator, "wakeLock", { value: { request: vi.fn(async () => ({ release })) }, configurable: true });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (f: ActivityFile = file) =>
  renderWithI18n(<DocumentViewer file={f} activityTitle="Vuelo a La Palma" onClose={onClose} onDelete={onDelete} />);

describe("DocumentViewer", () => {
  it("shows every page of the PDF", async () => {
    docs.pages = 3;
    open();
    expect(await screen.findByAltText("Página 1 de 3")).toBeTruthy();
    expect(screen.getByAltText("Página 2 de 3")).toBeTruthy();
    expect(screen.getByAltText("Página 3 de 3").getAttribute("src")).toBe("data:image/png;base64,page3");
    expect(screen.getByRole("heading", { name: "Vuelo a La Palma" })).toBeTruthy();
  });

  it("finds the codes on the device and shows them big on white, keeping the screen awake", async () => {
    docs.codes = [{ page: 0, kind: "qr", value: "M1GARCIA" }, { page: 1, kind: "barcode", value: "4006381333931" }];
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar código (2)" }));

    const spotlight = screen.getByRole("dialog", { name: "Código 1 de 2" });
    expect((await within(spotlight).findByRole("img", { name: "Código QR" })).getAttribute("src")).toBe("data:image/png;base64,crop-qr");
    expect(navigator.wakeLock.request).toHaveBeenCalledWith("screen");
    fireEvent.click(within(spotlight).getByRole("button", { name: "Siguiente código" }));
    expect(await screen.findByRole("dialog", { name: "Código 2 de 2" })).toBeTruthy();
    expect(screen.getByText("4006381333931")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar código" }));
    await waitFor(() => expect(release).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens a code by tapping its highlight on the page", async () => {
    docs.codes = [{ page: 0, kind: "qr", value: "M1GARCIA" }];
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Ampliar código QR de la página 1" }));
    expect(screen.getByRole("dialog", { name: "Código 1 de 1" })).toBeTruthy();
  });

  it("offers the AI scan only when nothing was found, sending a small JPEG", async () => {
    open();
    const scan = await screen.findByRole("button", { name: "Buscar con IA" });
    await act(async () => fireEvent.click(scan));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.imageUri.startsWith("data:image/jpeg")).toBe(true);
    expect(await screen.findByRole("button", { name: "Mostrar código (1)" })).toBeTruthy();
  });

  it("lets the traveler mark a code by hand and keeps it for the file", async () => {
    open();
    await screen.findByAltText("Página 1 de 2");
    fireEvent.click(screen.getByRole("button", { name: "Marcar el código a mano" }));
    const pageArea = screen.getByTestId("doc-page-0");
    pageArea.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerDown(pageArea, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(pageArea, { clientX: 60, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(pageArea, { clientX: 60, clientY: 120, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Guardar zona" }));
    await waitFor(() => expect(setFileFocusArea).toHaveBeenCalledWith("f1", { x: 0.1, y: 0.1, width: 0.5, height: 0.5, page: 0 }));
    expect(await screen.findByRole("button", { name: "Mostrar código (1)" })).toBeTruthy();
  });

  it("asks inside the app before deleting", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar archivo" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
  });

  it("explains when the file is not available offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    open();
    expect(await screen.findByText(/no está disponible sin conexión/i)).toBeTruthy();
  });
});
