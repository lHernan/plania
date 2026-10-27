/**
 * Finds QR codes and barcodes in a rendered page on the device: the browser's BarcodeDetector
 * when it has one, @zxing/library otherwise (Safari on iPhone, Firefox). No network, no AI.
 */

export type CodeBox = { x: number; y: number; width: number; height: number };

export type DetectedCode = {
  /** "qr" for square 2D codes (QR, Aztec, Data Matrix, PDF417), "barcode" for 1D ones. */
  kind: "qr" | "barcode";
  format: string;
  value: string;
  /** Normalized to the page: 0-1. */
  box: CodeBox;
};

export type PageImage = { data: Uint8ClampedArray; width: number; height: number };

const TWO_D = new Set(["qr_code", "aztec", "data_matrix", "pdf417", "QR_CODE", "AZTEC", "DATA_MATRIX", "PDF_417"]);
/** A boarding pass or ticket rarely has more than a few codes. */
const MAX_CODES = 4;
/** 1D barcodes come back as a line: give the box a usable height relative to its width. */
const BARCODE_HEIGHT_RATIO = 0.35;

type NativeDetector = {
  detect: (source: ImageData) => Promise<{ rawValue: string; format: string; boundingBox: DOMRectReadOnly }[]>;
};
type NativeDetectorClass = (new (options?: { formats?: string[] }) => NativeDetector) & {
  getSupportedFormats?: () => Promise<string[]>;
};

const kindOf = (format: string): DetectedCode["kind"] => (TWO_D.has(format) ? "qr" : "barcode");

function normalize(box: { x: number; y: number; width: number; height: number }, image: PageImage, format: string): CodeBox {
  const { x, width } = box;
  let { y, height } = box;
  if (kindOf(format) === "barcode" && height < width * BARCODE_HEIGHT_RATIO) {
    const target = width * BARCODE_HEIGHT_RATIO;
    y -= (target - height) / 2;
    height = target;
  }
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
  const left = clamp(x / image.width);
  const top = clamp(y / image.height);
  return {
    x: left,
    y: top,
    width: clamp((x + width) / image.width) - left,
    height: clamp((y + height) / image.height) - top,
  };
}

async function detectNative(image: PageImage): Promise<DetectedCode[] | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector || typeof ImageData === "undefined") return null;
  try {
    const formats = (await Detector.getSupportedFormats?.()) ?? undefined;
    const detector = new Detector(formats?.length ? { formats } : undefined);
    const found = await detector.detect(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height));
    return found.slice(0, MAX_CODES).map((code) => ({
      kind: kindOf(code.format),
      format: code.format,
      value: code.rawValue,
      box: normalize(code.boundingBox, image, code.format),
    }));
  } catch {
    return null;
  }
}

function toLuminance(image: PageImage): Uint8ClampedArray {
  const luminance = new Uint8ClampedArray(image.width * image.height);
  for (let i = 0, p = 0; i < luminance.length; i += 1, p += 4) {
    const alpha = image.data[p + 3] / 255;
    // Transparent pixels count as white paper.
    const gray = 0.299 * image.data[p] + 0.587 * image.data[p + 1] + 0.114 * image.data[p + 2];
    luminance[i] = gray * alpha + 255 * (1 - alpha);
  }
  return luminance;
}

async function detectWithZxing(image: PageImage): Promise<DetectedCode[]> {
  const zxing = await import("@zxing/library");
  const hints = new Map();
  hints.set(zxing.DecodeHintType.TRY_HARDER, true);
  // The readers one by one instead of MultiFormatReader: in 0.23 that one logs every normal
  // "no code here" result as a console warning.
  const readers = [
    new zxing.QRCodeReader(),
    new zxing.MultiFormatOneDReader(hints),
    new zxing.DataMatrixReader(),
    new zxing.PDF417Reader(),
    new zxing.AztecCodeReader(),
  ];
  const decode = (bitmap: InstanceType<typeof zxing.BinaryBitmap>) => {
    for (const reader of readers) {
      try {
        return reader.decode(bitmap, hints);
      } catch {
        // Not this kind of code: try the next reader.
      } finally {
        reader.reset();
      }
    }
    return null;
  };

  const luminance = toLuminance(image);
  const codes: DetectedCode[] = [];
  // zxing reads one code at a time: paint each found code white and look again. A tall
  // barcode can be read again from rows outside its box, so repeats grow the painted band.
  let grown = 1;
  for (let attempt = 0; attempt < MAX_CODES * 2 && codes.length < MAX_CODES; attempt += 1) {
    const source = new zxing.RGBLuminanceSource(luminance, image.width, image.height);
    const result = decode(new zxing.BinaryBitmap(new zxing.HybridBinarizer(source)));
    if (!result) break; // Nothing (else) on the page.
    const points = result.getResultPoints().filter(Boolean);
    if (points.length === 0) break;
    const xs = points.map((p) => p.getX());
    const ys = points.map((p) => p.getY());
    const format = zxing.BarcodeFormat[result.getBarcodeFormat()];
    const raw = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    // QR result points sit on the finder pattern centers: grow the box to the whole symbol.
    const grow = kindOf(format) === "qr" ? Math.max(raw.width, raw.height) * 0.2 : 0;
    const pixelBox = { x: raw.x - grow, y: raw.y - grow, width: raw.width + grow * 2, height: raw.height + grow * 2 };
    const box = normalize(pixelBox, image, format);
    const repeat = codes.some((code) => code.value === result.getText() && code.format === format);
    grown = repeat ? grown * 2 : 1;
    if (!repeat) codes.push({ kind: kindOf(format), format, value: result.getText(), box });

    const extra = (box.height * (grown - 1)) / 2;
    const left = Math.max(Math.floor(box.x * image.width), 0);
    const top = Math.max(Math.floor((box.y - extra) * image.height), 0);
    const right = Math.min(Math.ceil((box.x + box.width) * image.width), image.width);
    const bottom = Math.min(Math.ceil((box.y + box.height + extra) * image.height), image.height);
    if (right <= left || bottom <= top) break;
    for (let row = top; row < bottom; row += 1) luminance.fill(255, row * image.width + left, row * image.width + right);
  }
  return codes;
}

export async function detectCodes(image: PageImage): Promise<DetectedCode[]> {
  const native = await detectNative(image);
  if (native && native.length > 0) return native;
  try {
    return await detectWithZxing(image);
  } catch {
    return [];
  }
}
