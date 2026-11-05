// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_MAX_EDGE, IMAGE_WEBP_QUALITY, compressImage } from "@/lib/image-compress";

type Drawn = { width: number; height: number; quality?: number; type?: string };

/** Fakes createImageBitmap + OffscreenCanvas; the encoded blob has `outputSize` bytes. */
function mockCanvas(bitmap: { width: number; height: number }, outputSize: number, outputType = "image/webp") {
  const drawn: Drawn[] = [];
  const close = vi.fn();
  const createImageBitmap = vi.fn(async () => ({ ...bitmap, close }));
  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return { drawImage: vi.fn() };
    }
    async convertToBlob(options: { type: string; quality: number }) {
      drawn.push({ width: this.width, height: this.height, quality: options.quality, type: options.type });
      return new Blob([new Uint8Array(outputSize)], { type: outputType });
    }
  }
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  return { drawn, createImageBitmap, close };
}

const photo = (size: number, type = "image/jpeg", name = "IMG_0001.jpg") => new File([new Uint8Array(size)], name, { type });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compressImage", () => {
  it("downscales the long edge to 2048 px and encodes WebP, honoring EXIF orientation", async () => {
    const mock = mockCanvas({ width: 4032, height: 3024 }, 200_000);
    const original = photo(3_000_000);
    const result = await compressImage(original);

    expect(mock.createImageBitmap).toHaveBeenCalledWith(original, { imageOrientation: "from-image" });
    expect(mock.drawn).toEqual([{ width: IMAGE_MAX_EDGE, height: 1536, quality: IMAGE_WEBP_QUALITY, type: "image/webp" }]);
    expect(result).not.toBe(original);
    expect(result.type).toBe("image/webp");
    expect(result.size).toBe(200_000);
    expect(result.name).toBe("IMG_0001.webp");
    expect(mock.close).toHaveBeenCalled();
  });

  it("keeps the size of an image already within the limit", async () => {
    const mock = mockCanvas({ width: 800, height: 1200 }, 50_000);
    await compressImage(photo(400_000));
    expect(mock.drawn[0]).toMatchObject({ width: 800, height: 1200 });
  });

  it("returns the original when the encoded image is not smaller", async () => {
    mockCanvas({ width: 1000, height: 1000 }, 500_000);
    const original = photo(400_000);
    expect(await compressImage(original)).toBe(original);
  });

  it("returns the original when the browser cannot encode WebP", async () => {
    mockCanvas({ width: 4000, height: 3000 }, 10, "image/png");
    const original = photo(400_000);
    expect(await compressImage(original)).toBe(original);
  });

  it("returns the original when decoding fails or the APIs are missing", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("decode");
    }));
    const original = photo(400_000);
    expect(await compressImage(original)).toBe(original);

    vi.stubGlobal("createImageBitmap", undefined);
    expect(await compressImage(original)).toBe(original);
  });
});
