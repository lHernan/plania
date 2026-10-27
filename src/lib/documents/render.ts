import type { CodeBox, PageImage } from "@/lib/documents/codes";
import { cropRect } from "@/lib/documents/geometry";

/**
 * A document as pages that render on demand to a canvas: every page of a PDF (pdf.js, same
 * worker as the booking import) or a single page for an image.
 */
export type DocPage = {
  /** Size at scale 1 (PDF points or image pixels). */
  width: number;
  height: number;
  render: (scale: number) => Promise<HTMLCanvasElement>;
};

/** Never paint a page bigger than this many pixels on its longest side (memory on phones). */
const MAX_SIDE_PX = 4096;
/**
 * Sizes tried when looking for codes, smallest first: a medium render blends the hairline gaps
 * some PDFs leave between QR modules; a larger one finds small codes.
 */
export const DETECTION_SIDES_PX = [1200, 2400] as const;

function canvasFor(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

const limit = (scale: number, page: { width: number; height: number }, side = MAX_SIDE_PX) =>
  Math.min(scale, side / Math.max(page.width, page.height));

async function loadPdf(url: string): Promise<DocPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument(url).promise;
  const pages: DocPage[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    pages.push({
      width: base.width,
      height: base.height,
      render: async (scale) => {
        const viewport = page.getViewport({ scale: limit(scale, base) });
        const canvas = canvasFor(viewport.width, viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas not available");
        // White paper: transparent PDF backgrounds would hide black codes on a dark viewer.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        return canvas;
      },
    });
  }
  return pages;
}

async function loadImage(url: string): Promise<DocPage[]> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const base = { width: image.naturalWidth, height: image.naturalHeight };
  return [
    {
      ...base,
      render: async (scale) => {
        const factor = limit(scale, base);
        const canvas = canvasFor(base.width * factor, base.height * factor);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas not available");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
      },
    },
  ];
}

export function loadDocument(url: string, fileType: "pdf" | "image" | "other"): Promise<DocPage[]> {
  return fileType === "pdf" ? loadPdf(url) : loadImage(url);
}

/** The page's pixels with its longest side at `sidePx`, to look for codes. */
export async function pageImage(page: DocPage, sidePx: number = DETECTION_SIDES_PX[0]): Promise<PageImage> {
  const canvas = await page.render(sidePx / Math.max(page.width, page.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas not available");
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

/**
 * The code cut out of its page and painted large and sharp (rendered again at a high scale,
 * not a stretched screenshot), as an image URL for the show-code screen.
 */
export async function renderCrop(page: DocPage, box: CodeBox, kind: "qr" | "barcode", targetSidePx = 1400): Promise<string> {
  const codeSide = Math.max(box.width * page.width, box.height * page.height, 1);
  const canvas = await page.render(Math.min(Math.max(targetSidePx / codeSide, 2), 10));
  const rect = cropRect(box, { width: canvas.width, height: canvas.height }, kind);
  const crop = canvasFor(rect.sw, rect.sh);
  const context = crop.getContext("2d");
  if (!context) throw new Error("Canvas not available");
  context.imageSmoothingEnabled = false;
  context.drawImage(canvas, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, crop.width, crop.height);
  return crop.toDataURL("image/png");
}
