import { NextResponse } from "next/server";

type GeocodeRequest = {
  locations: string[];
  city?: string;
  anchorLat?: number;
  anchorLng?: number;
};

type GeocodeResult =
  | { location: string; lat: number; lng: number }
  | { location: string; error: string };

type GeoapifyJsonResult = {
  lat?: number;
  lon?: number;
  country_code?: string;
};

type GeoapifyJsonResponse = {
  results?: GeoapifyJsonResult[];
};

function extractFirst(data: GeoapifyJsonResponse): GeoapifyJsonResult | null {
  const r = data.results?.[0];
  if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) return r;
  return null;
}

/**
 * Resolve the city to get its country code for hard filtering.
 * "Barcelona" → { countryCode: "es", lat: 41.39, lon: 2.17 }
 */
async function resolveCity(
  city: string,
  apiKey: string,
): Promise<{ countryCode: string; lat: number; lon: number } | null> {
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", city);
  url.searchParams.set("type", "city");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("apiKey", apiKey);

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GeoapifyJsonResponse;
    const r = extractFirst(data);
    if (r?.country_code) {
      return { countryCode: r.country_code, lat: r.lat!, lon: r.lon! };
    }
  } catch {}
  return null;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    const body = (await request.json()) as GeocodeRequest;

    if (!Array.isArray(body.locations) || body.locations.length === 0) {
      return NextResponse.json(
        { error: "locations must be a non-empty array" },
        { status: 400 },
      );
    }

    if (body.locations.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 locations per request" },
        { status: 400 },
      );
    }

    if (!apiKey) {
      return NextResponse.json({
        results: [],
        warning: "Geocoding provider is not configured.",
      });
    }

    const city = body.city?.trim() ?? "";
    const hasAnchor =
      Number.isFinite(body.anchorLat) && Number.isFinite(body.anchorLng);

    // When explicit anchor coords are provided (e.g. device GPS), skip city resolution
    const cityInfo =
      !hasAnchor && city ? await resolveCity(city, apiKey) : null;

    const results = await Promise.allSettled(
      body.locations.map(async (loc): Promise<GeocodeResult> => {
        const url = new URL("https://api.geoapify.com/v1/geocode/search");
        url.searchParams.set("text", `${loc}, ${city}`);
        url.searchParams.set("format", "json");
        url.searchParams.set("limit", "1");
        url.searchParams.set("apiKey", apiKey);

        if (hasAnchor) {
          // GPS anchor: hard circle filter (50 km) + proximity bias
          url.searchParams.set(
            "filter",
            `circle:${body.anchorLng},${body.anchorLat},50000`,
          );
          url.searchParams.set(
            "bias",
            `proximity:${body.anchorLng},${body.anchorLat}`,
          );
        } else if (cityInfo) {
          // City-derived anchor: country code + proximity bias
          url.searchParams.set("filter", `countrycode:${cityInfo.countryCode}`);
          url.searchParams.set(
            "bias",
            `proximity:${cityInfo.lon},${cityInfo.lat}`,
          );
        }

        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          return { location: loc, error: `Geocoding failed (${res.status})` };
        }

        const data = (await res.json()) as GeoapifyJsonResponse;
        const r = extractFirst(data);

        if (r) {
          return { location: loc, lat: r.lat!, lng: r.lon! };
        }

        return { location: loc, error: "No coordinates found" };
      }),
    );

    const mapped: GeocodeResult[] = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { location: body.locations[i], error: "Geocoding request failed" },
    );

    return NextResponse.json({ results: mapped });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown geocoding error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Reverse-geocode GPS coordinates → city name.
 * GET /api/geocode?lat=41.39&lng=2.17
 */
export async function GET(request: Request) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 },
    );
  }

  if (!apiKey) {
    return NextResponse.json({ city: null });
  }

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return NextResponse.json({ city: null });

    const data = (await res.json()) as GeoapifyJsonResponse;
    const r = data.results?.[0];
    const city =
      (r as Record<string, unknown>)?.city ??
      (r as Record<string, unknown>)?.state ??
      null;
    return NextResponse.json({ city });
  } catch {
    return NextResponse.json({ city: null });
  }
}
