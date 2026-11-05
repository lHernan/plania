// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRIP_COVER_MAX_BYTES,
  canEditTripCover,
  clearTripCoverUrlCache,
  resolveTripCoverUrl,
  tripCoverObjectPath,
  validateTripCoverFile,
} from "@/lib/trip-cover";

const file = (type: string, size = 1000) => new File([new Uint8Array(size)], "cover", { type });

function client(result: { data: { signedUrl: string } | null; error: { message: string } | null }) {
  const createSignedUrl = vi.fn(async () => result);
  const from = vi.fn(() => ({ createSignedUrl }));
  return { client: { storage: { from } }, from, createSignedUrl };
}

beforeEach(() => {
  clearTripCoverUrlCache();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("validateTripCoverFile", () => {
  it("accepts JPEG, PNG and WebP up to 5 MB", () => {
    expect(validateTripCoverFile(file("image/jpeg"))).toBeNull();
    expect(validateTripCoverFile(file("image/png"))).toBeNull();
    expect(validateTripCoverFile(file("image/webp", TRIP_COVER_MAX_BYTES))).toBeNull();
  });

  it("rejects other types and files over 5 MB", () => {
    expect(validateTripCoverFile(file("image/gif"))).toBe("type");
    expect(validateTripCoverFile(file("image/svg+xml"))).toBe("type");
    expect(validateTripCoverFile(file("image/png", TRIP_COVER_MAX_BYTES + 1))).toBe("size");
  });
});

describe("tripCoverObjectPath", () => {
  it("puts the object in the trip folder with an extension from its type", () => {
    expect(tripCoverObjectPath("trip-1", "image/webp", "abc")).toBe("trip-1/abc.webp");
    expect(tripCoverObjectPath("trip-1", "image/jpeg", "abc")).toBe("trip-1/abc.jpg");
  });
});

describe("canEditTripCover", () => {
  const trip = { id: "t", userId: "owner" };
  it("allows the owner and editors, never viewers or strangers", () => {
    expect(canEditTripCover(trip, "owner")).toBe(true);
    expect(canEditTripCover({ ...trip, packing: { role: "editor" } }, "ed")).toBe(true);
    expect(canEditTripCover({ ...trip, packing: { role: "viewer" } }, "v")).toBe(false);
    expect(canEditTripCover(trip, "someone")).toBe(false);
    expect(canEditTripCover(trip, null)).toBe(false);
  });
});

describe("resolveTripCoverUrl", () => {
  it("signs the path in the private trip-covers bucket for an hour and caches it", async () => {
    const mock = client({ data: { signedUrl: "https://signed/1" }, error: null });
    expect(await resolveTripCoverUrl("t/a.jpg", mock.client)).toBe("https://signed/1");
    expect(await resolveTripCoverUrl("t/a.jpg", mock.client)).toBe("https://signed/1");
    expect(mock.from).toHaveBeenCalledWith("trip-covers");
    expect(mock.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(mock.createSignedUrl).toHaveBeenCalledWith("t/a.jpg", 3600);
  });

  it("falls back to no image on an error, a throw or offline, without caching the failure", async () => {
    const failing = client({ data: null, error: { message: "Object not found" } });
    expect(await resolveTripCoverUrl("t/b.jpg", failing.client)).toBeNull();
    const throwing = { storage: { from: () => ({ createSignedUrl: async () => { throw new Error("network"); } }) } };
    expect(await resolveTripCoverUrl("t/b.jpg", throwing)).toBeNull();

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const offline = client({ data: { signedUrl: "https://signed/2" }, error: null });
    expect(await resolveTripCoverUrl("t/c.jpg", offline.client)).toBeNull();
    expect(offline.createSignedUrl).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const ok = client({ data: { signedUrl: "https://signed/3" }, error: null });
    expect(await resolveTripCoverUrl("t/b.jpg", ok.client)).toBe("https://signed/3");
  });
});
