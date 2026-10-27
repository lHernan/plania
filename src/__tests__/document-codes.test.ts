import { afterEach, describe, expect, it, vi } from "vitest";
import { BarcodeFormat, EncodeHintType, MultiFormatWriter } from "@zxing/library";
import { detectCodes, type PageImage } from "@/lib/documents/codes";

type Paint = { value: string; x: number; y: number; w: number; h: number };

/** EAN-13 modules (zxing-js has no 1D encoder): 1 = bar. */
function ean13Modules(digits: string): string {
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
  const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const d = digits.split("").map(Number);
  let bits = "101";
  for (let i = 1; i <= 6; i += 1) bits += (PARITY[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i += 1) bits += R[d[i]];
  return bits + "101";
}

/** A white RGBA page with a QR (zxing's encoder) and/or an EAN-13 barcode painted on it. */
function page(width: number, height: number, codes: { qr?: Paint; ean13?: Paint }): PageImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const black = (x: number, y: number) => {
    const p = (y * width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = 0;
  };
  if (codes.qr) {
    const { value, x, y, w, h } = codes.qr;
    const matrix = new MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, w, h, new Map([[EncodeHintType.MARGIN, 2]]));
    for (let row = 0; row < h; row += 1) for (let col = 0; col < w; col += 1) if (matrix.get(col, row)) black(x + col, y + row);
  }
  if (codes.ean13) {
    const { value, x, y, w, h } = codes.ean13;
    const modules = ean13Modules(value);
    const unit = Math.floor(w / modules.length);
    for (let m = 0; m < modules.length; m += 1) {
      if (modules[m] !== "1") continue;
      for (let row = 0; row < h; row += 1) for (let px = 0; px < unit; px += 1) black(x + m * unit + px, y + row);
    }
  }
  return { data, width, height };
}

afterEach(() => {
  delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
});

describe("detectCodes without a native detector (zxing)", () => {
  it("reads a QR code and a barcode on the same page and says where they are", async () => {
    const image = page(600, 800, {
      qr: { value: "M1GARCIA/ANA EABC123 MADSPCIB 3901", x: 40, y: 40, w: 240, h: 240 },
      ean13: { value: "4006381333931", x: 60, y: 560, w: 380, h: 120 },
    });
    const codes = await detectCodes(image);
    expect(codes.map((c) => [c.kind, c.value]).sort()).toEqual([
      ["barcode", "4006381333931"],
      ["qr", "M1GARCIA/ANA EABC123 MADSPCIB 3901"],
    ]);
    const qr = codes.find((c) => c.kind === "qr")!;
    // The box covers the symbol (40-280 px of 600 wide, 40-280 of 800 high), within a few pixels.
    expect(qr.box.x).toBeGreaterThan(0.03);
    expect(qr.box.x).toBeLessThan(0.12);
    expect(qr.box.x + qr.box.width).toBeGreaterThan(0.4);
    expect(qr.box.x + qr.box.width).toBeLessThan(0.5);
    const barcode = codes.find((c) => c.kind === "barcode")!;
    expect(barcode.box.y).toBeGreaterThan(0.6);
    expect(barcode.box.height).toBeGreaterThan(0.05);
  });

  it("finds nothing on a blank page", async () => {
    expect(await detectCodes(page(300, 300, {}))).toEqual([]);
  });

  it("does not flood the console while looking (pages without codes are the normal case)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await detectCodes(page(300, 300, {}));
    await detectCodes(page(600, 800, { qr: { value: "ABC", x: 40, y: 40, w: 240, h: 240 } }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("detectCodes with the browser's BarcodeDetector", () => {
  it("uses it and normalizes its boxes", async () => {
    vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    const detect = vi.fn(async () => [{ rawValue: "ABC", format: "qr_code", boundingBox: { x: 100, y: 200, width: 200, height: 200 } }]);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = Object.assign(
      vi.fn(function (this: { detect: typeof detect }) { this.detect = detect; }),
      { getSupportedFormats: async () => ["qr_code", "code_128"] },
    );
    const codes = await detectCodes({ data: new Uint8ClampedArray(1000 * 1000 * 4), width: 1000, height: 1000 });
    expect(codes).toEqual([{ kind: "qr", format: "qr_code", value: "ABC", box: { x: expect.closeTo(0.1), y: expect.closeTo(0.2), width: expect.closeTo(0.2), height: expect.closeTo(0.2) } }]);
    vi.unstubAllGlobals();
  });
});
