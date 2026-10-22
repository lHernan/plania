import { NextResponse } from "next/server";
import type { WeatherSummary } from "@/lib/types";

type GeoResult = { latitude: number; longitude: number; name: string };

type ForecastDay = {
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
};

// OpenMeteo forecast covers ~16 days ahead. Beyond that we use the
// historical weather API with the same dates from the previous year.
const MAX_FORECAST_DAYS = 16;

// In-memory cache keyed by "city|start|end", refreshed hourly.
const cache = new Map<string, { data: WeatherSummary; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function geocode(city: string): Promise<GeoResult | null> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

async function fetchForecast(
  lat: number,
  lon: number,
  start: string,
  end: string,
): Promise<ForecastDay | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&start_date=${start}&end_date=${end}` +
    `&timezone=auto`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const data = (await res.json()) as { daily?: ForecastDay };
  return data.daily ?? null;
}

async function fetchHistorical(
  lat: number,
  lon: number,
  start: string,
  end: string,
): Promise<ForecastDay | null> {
  // Shift dates back 1 year to get historical climate as a proxy.
  const s = new Date(start);
  const e = new Date(end);
  s.setFullYear(s.getFullYear() - 1);
  e.setFullYear(e.getFullYear() - 1);

  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&start_date=${toDateStr(s)}&end_date=${toDateStr(e)}` +
    `&timezone=auto`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const data = (await res.json()) as { daily?: ForecastDay };
  return data.daily ?? null;
}

function nums(arr?: (number | null)[]): number[] {
  return (arr ?? []).filter((v): v is number => v != null);
}

function summarize(city: string, d: ForecastDay): WeatherSummary {
  const mins = nums(d.temperature_2m_min);
  const maxs = nums(d.temperature_2m_max);

  // Forecast has precipitation_probability_max; archive has precipitation_sum.
  // For archive, estimate "rain chance" as % of days with >0.5mm precipitation.
  let rainPct = 0;
  const probabilities = nums(d.precipitation_probability_max);
  if (probabilities.length) {
    rainPct = Math.max(...probabilities);
  } else {
    const sums = nums(d.precipitation_sum);
    if (sums.length) {
      const rainyDays = sums.filter((v) => v > 0.5).length;
      rainPct = Math.round((rainyDays / sums.length) * 100);
    }
  }

  return {
    city,
    tempMinC: mins.length ? Math.round(Math.min(...mins)) : 0,
    tempMaxC: maxs.length ? Math.round(Math.max(...maxs)) : 0,
    rainProbabilityMax: rainPct,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city")?.trim();
  const start = searchParams.get("start"); // YYYY-MM-DD
  const end = searchParams.get("end"); // YYYY-MM-DD

  if (!city || !start || !end) {
    return NextResponse.json(
      { error: "city, start, and end query params are required" },
      { status: 400 },
    );
  }

  const cacheKey = `${city.toLowerCase()}|${start}|${end}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const geo = await geocode(city);
    if (!geo) {
      return NextResponse.json({ error: `Could not geocode "${city}"` }, { status: 404 });
    }

    const today = new Date();
    const startDate = new Date(start);
    const maxForecast = new Date(today);
    maxForecast.setDate(maxForecast.getDate() + MAX_FORECAST_DAYS);

    let daily: ForecastDay | null = null;

    if (startDate <= maxForecast) {
      // At least part of the range is within forecast window — clamp end
      const clampedEnd = new Date(end) <= maxForecast ? end : toDateStr(maxForecast);
      const clampedStart = startDate >= today ? start : toDateStr(today);
      daily = await fetchForecast(geo.latitude, geo.longitude, clampedStart, clampedEnd);
    }

    // Fallback: use historical data from the same dates last year
    if (!daily || !daily.temperature_2m_max?.length) {
      daily = await fetchHistorical(geo.latitude, geo.longitude, start, end);
    }

    if (!daily || !daily.temperature_2m_max?.length) {
      return NextResponse.json(
        { error: `No weather data available for "${city}"` },
        { status: 404 },
      );
    }

    const summary = summarize(geo.name || city, daily);
    cache.set(cacheKey, { data: summary, fetchedAt: Date.now() });
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown weather error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
