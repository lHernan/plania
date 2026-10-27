import { hasMeaningfulText } from "@/lib/bookings/extract";

/**
 * Browser-only PDF reader for booking import. pdfjs is loaded lazily so this module never runs
 * pdfjs on the server; the size/header checks and helpers are pure.
 */

export type PdfReadResult = {
  sha256: string;
  pageCount: number;
  pages: { index: number; text: string }[];
  /** PNG data URLs of pages without a text layer (likely scanned). */
  imagePages: string[];
};

export type PdfReadErrorCode = "invalid" | "encrypted" | "too_large";

export class PdfReadError extends Error {
  readonly code: PdfReadErrorCode;

  constructor(code: PdfReadErrorCode, message?: string) {
    super(message ?? `PDF read failed: ${code}`);
    this.name = "PdfReadError";
    this.code = code;
  }
}

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_PAGES = 4;
const RENDER_SCALE = 1.5;

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  // "%PDF-" may be preceded by a little garbage; the spec allows it within the first 1024 bytes.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export async function readPdf(file: File, options?: { maxImagePages?: number }): Promise<PdfReadResult> {
  if (file.size > MAX_PDF_BYTES) throw new PdfReadError("too_large");

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!hasPdfHeader(bytes)) throw new PdfReadError("invalid");

  const sha256 = toHex(await crypto.subtle.digest("SHA-256", buffer));
  const maxImagePages = options?.maxImagePages ?? DEFAULT_MAX_IMAGE_PAGES;

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    // pdfjs transfers the data to the worker, so hand it a copy.
    pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new PdfReadError(name === "PasswordException" ? "encrypted" : "invalid");
  }

  try {
    const pages: PdfReadResult["pages"] = [];
    const imagePages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+/g, " ")
        .trim();
      pages.push({ index: pageNumber - 1, text });

      if (!hasMeaningfulText(text) && imagePages.length < maxImagePages) {
        const image = await renderPage(page);
        if (image) imagePages.push(image);
      }
      page.cleanup();
    }

    return { sha256, pageCount: pdf.numPages, pages, imagePages };
  } catch (error) {
    if (error instanceof PdfReadError) throw error;
    throw new PdfReadError("invalid");
  } finally {
    void pdf.destroy();
  }
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist")["getDocument"]>["promise"]>["getPage"]>>;

async function renderPage(page: PdfPage): Promise<string | null> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  const dataUrl = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}
