import { NextResponse } from "next/server";

type NearbyPlacesRequest = {
  lat: number;
  lon: number;
  radius_m?: number;
  limit?: number;
  categories?: string;
  name?: string;
};

type CandidatePlace = { name: string; area: string | null };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

type GeoapifyFeature = {
  properties?: {
    name?: string;
    city?: string;
    district?: string;
    suburb?: string;
  };
};

type GeoapifyFeatureCollection = {
  features?: GeoapifyFeature[];
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEOAPIFY_API_KEY is not configured on the server." },
        { status: 501 },
      );
    }

    const body = (await request.json()) as NearbyPlacesRequest;
    if (!isFiniteNumber(body.lat) || !isFiniteNumber(body.lon)) {
      return NextResponse.json({ error: "lat/lon are required numbers" }, { status: 400 });
    }

    const radius = Math.max(200, Math.min(5000, Math.floor(body.radius_m ?? 1500)));
    const limit = Math.max(1, Math.min(20, Math.floor(body.limit ?? 12)));
    const categories = (body.categories && body.categories.trim()) || "commercial";
    const name = body.name?.trim();

    const url = new URL("https://api.geoapify.com/v2/places");
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("categories", categories);
    url.searchParams.set("filter", `circle:${body.lon},${body.lat},${radius}`);
    url.searchParams.set("bias", `proximity:${body.lon},${body.lat}`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("lang", "en");
    if (name) url.searchParams.set("name", name);

    const res = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Geoapify error (${res.status})`, details: text.slice(0, 300) },
        { status: 502 },
      );
    }

    const data = (await res.json()) as GeoapifyFeatureCollection;
    const features = Array.isArray(data.features) ? data.features : [];
    const places: CandidatePlace[] = [];
    const seen = new Set<string>();

    for (const feature of features) {
      const props = feature?.properties;
      const nameValue: string | undefined = props?.name;
      const cityValue: string | undefined = props?.city;
      const districtValue: string | undefined = props?.district;
      const suburbValue: string | undefined = props?.suburb;
      const area = districtValue || suburbValue || cityValue || null;
      const displayName = typeof nameValue === "string" ? nameValue.trim() : "";
      if (!displayName) continue;

      const key = `${displayName.toLowerCase()}|${(area ?? "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({ name: displayName, area });
    }

    return NextResponse.json({
      places,
      attribution: "Powered by Geoapify / OpenStreetMap",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown nearby places error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
