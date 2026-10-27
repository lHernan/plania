import { describe, expect, it } from "vitest";
import { clampPan, cropRect, MAX_ZOOM, zoomAt } from "@/lib/documents/geometry";

describe("zoomAt", () => {
  it("keeps the point under the fingers still while zooming", () => {
    const next = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 200 });
    expect(next).toEqual({ scale: 2, x: -100, y: -200 });
    // The content point that was at (100, 200) is still there: (100 - x) / scale = 100.
    expect((100 - next.x) / next.scale).toBe(100);
  });

  it("stays between 1x and the maximum", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }).scale).toBe(1);
    expect(zoomAt({ scale: 5, x: 0, y: 0 }, 4, { x: 0, y: 0 }).scale).toBe(MAX_ZOOM);
  });
});

describe("clampPan", () => {
  const container = { width: 400, height: 800 };

  it("does not let the document leave empty space past its edges", () => {
    // A 400x2000 column at 2x is 800x4000: x within [-400, 0], y within [-3200, 0].
    expect(clampPan({ scale: 2, x: 50, y: 100 }, container, { width: 400, height: 2000 })).toEqual({ scale: 2, x: 0, y: 0 });
    expect(clampPan({ scale: 2, x: -900, y: -5000 }, container, { width: 400, height: 2000 })).toEqual({ scale: 2, x: -400, y: -3200 });
  });

  it("centers what is smaller than the screen", () => {
    expect(clampPan({ scale: 1, x: -30, y: -30 }, container, { width: 300, height: 500 })).toEqual({ scale: 1, x: 50, y: 150 });
  });
});

describe("cropRect", () => {
  it("cuts a square around a QR with a quiet-zone margin", () => {
    const rect = cropRect({ x: 0.1, y: 0.1, width: 0.2, height: 0.15 }, { width: 1000, height: 1000 }, "qr");
    expect(rect.sw).toBeCloseTo(248);
    expect(rect.sh).toBeCloseTo(248);
    // Centered on the code (200, 175).
    expect(rect.sx + rect.sw / 2).toBeCloseTo(200);
    expect(rect.sy + rect.sh / 2).toBeCloseTo(175);
  });

  it("keeps a barcode wide and never leaves the page", () => {
    const rect = cropRect({ x: 0.7, y: 0.9, width: 0.3, height: 0.1 }, { width: 1000, height: 1000 }, "barcode");
    expect(rect.sw).toBeGreaterThan(rect.sh);
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(1000);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(1000);
    expect(rect.sx).toBeGreaterThanOrEqual(0);
  });
});
