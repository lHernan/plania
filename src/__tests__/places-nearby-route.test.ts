import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/places/nearby/route";

const fetchMock = vi.fn();

function post(body: unknown) {
  return POST(new Request("http://localhost/api/places/nearby", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/places/nearby", () => {
  beforeEach(() => {
    vi.stubEnv("GEOAPIFY_API_KEY", "geo-key");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns where each place is and what it sells, besides its name and area", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      features: [
        { properties: { name: "Mercadona", city: "Santa Cruz", address_line2: "Calle Real 5, Santa Cruz", lat: 28.69, lon: -17.76, categories: ["commercial", "commercial.supermarket"] } },
        { properties: { name: "Sin coordenadas", city: "Santa Cruz" } },
        { properties: { city: "Santa Cruz", lat: 1, lon: 2 } },
      ],
    })));
    const res = await post({ lat: 28.68, lon: -17.76, categories: "commercial.supermarket,commercial.marketplace", limit: 10 });
    const body = await res.json();
    expect(body.places).toEqual([
      { name: "Mercadona", area: "Santa Cruz", address: "Calle Real 5, Santa Cruz", lat: 28.69, lon: -17.76, categories: ["commercial", "commercial.supermarket"] },
      { name: "Sin coordenadas", area: "Santa Cruz", address: null, lat: null, lon: null, categories: [] },
    ]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("categories")).toBe("commercial.supermarket,commercial.marketplace");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("still defaults to any commercial place", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ features: [] })));
    await post({ lat: 28.68, lon: -17.76 });
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("categories")).toBe("commercial");
  });
});
