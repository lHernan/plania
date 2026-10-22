import { NextResponse } from "next/server";

type FrankfurterResponse = {
  base: string;
  date: string;
  rates: Record<string, number>;
};

// In-memory cache: one entry per base currency, refreshed hourly.
const cache = new Map<string, { data: FrankfurterResponse; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = (searchParams.get("base") ?? "USD").toUpperCase();
  const target = (searchParams.get("target") ?? "").toUpperCase();

  if (!target) {
    return NextResponse.json({ error: "target query param is required" }, { status: 400 });
  }

  if (base === target) {
    return NextResponse.json({ base, target, rate: 1, date: new Date().toISOString().slice(0, 10) });
  }

  try {
    const cached = cache.get(base);
    let data: FrankfurterResponse;

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      data = cached.data;
    } else {
      const res = await fetch(
        `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`,
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: `Exchange rate provider returned ${res.status}` },
          { status: 502 },
        );
      }
      data = (await res.json()) as FrankfurterResponse;
      cache.set(base, { data, fetchedAt: Date.now() });
    }

    const rate = data.rates[target];
    if (rate == null) {
      return NextResponse.json(
        { error: `No rate found for ${target}` },
        { status: 404 },
      );
    }

    return NextResponse.json({ base, target, rate, date: data.date });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown currency error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
