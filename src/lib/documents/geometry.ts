import type { CodeBox } from "@/lib/documents/codes";

/** Translate (in container pixels) and scale applied to the document column, from its top-left. */
export type ZoomState = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** Double tap zooms to this, or back to 1 when already zoomed in. */
export const DOUBLE_TAP_ZOOM = 2.5;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Zooms by `factor` keeping the content under `point` (container coordinates) still. */
export function zoomAt(state: ZoomState, factor: number, point: Point): ZoomState {
  const scale = clamp(state.scale * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = scale / state.scale;
  return { scale, x: point.x - (point.x - state.x) * ratio, y: point.y - (point.y - state.y) * ratio };
}

/**
 * Keeps the content inside the container: no empty space past the edges, and centered on an
 * axis where it is smaller than the container.
 */
export function clampPan(state: ZoomState, container: Size, content: Size): ZoomState {
  const width = content.width * state.scale;
  const height = content.height * state.scale;
  const x = width <= container.width ? (container.width - width) / 2 : clamp(state.x, container.width - width, 0);
  const y = height <= container.height ? (container.height - height) / 2 : clamp(state.y, container.height - height, 0);
  return { scale: state.scale, x, y };
}

/**
 * The pixel rectangle to cut around a code on a page rendered at `page` size: a margin so the
 * scanner sees the quiet zone, square for 2D codes, never outside the page.
 */
export function cropRect(box: CodeBox, page: Size, kind: "qr" | "barcode"): { sx: number; sy: number; sw: number; sh: number } {
  let width = box.width * page.width;
  let height = box.height * page.height;
  const centerX = (box.x + box.width / 2) * page.width;
  const centerY = (box.y + box.height / 2) * page.height;
  if (kind === "qr") width = height = Math.max(width, height);
  const margin = Math.max(width, height) * 0.12;
  width += margin * 2;
  height += margin * 2;
  const sw = Math.min(width, page.width);
  const sh = Math.min(height, page.height);
  return {
    sx: clamp(centerX - sw / 2, 0, page.width - sw),
    sy: clamp(centerY - sh / 2, 0, page.height - sh),
    sw,
    sh,
  };
}
