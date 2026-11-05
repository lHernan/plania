/** Long edge, in pixels, of an image after compression. */
export const IMAGE_MAX_EDGE = 2048;
/** WebP quality used when re-encoding. */
export const IMAGE_WEBP_QUALITY = 0.82;

type Canvas2D = { drawImage: (image: CanvasImageSource, x: number, y: number, width: number, height: number) => void };

/** Draws the bitmap at the given size and encodes it as WebP; null when the browser cannot. */
async function encodeWebp(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d") as Canvas2D | null;
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/webp", quality });
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

/**
 * Browser-side downscale (long edge at most 2048 px) and WebP re-encode of a photo, keeping
 * its EXIF orientation. Anything that fails, a browser without WebP encoding, or a result that
 * is not smaller returns the original file unchanged.
 */
export async function compressImage(file: File, maxEdge: number = IMAGE_MAX_EDGE, quality: number = IMAGE_WEBP_QUALITY): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const blob = await encodeWebp(bitmap, width, height, quality);
    // A browser without WebP encoding falls back to PNG: keep the original then.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    const name = /\.[^./]+$/.test(file.name) ? file.name.replace(/\.[^./]+$/, ".webp") : `${file.name}.webp`;
    return new File([blob], name, { type: "image/webp", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
