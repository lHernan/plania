import { toMinutes } from "@/lib/bookings/plan";
import type { Coords } from "@/lib/day-genius/context";

/**
 * Hourly weather for the rest of one day plus a daily outlook for other dates, from
 * Open-Meteo (the provider the app already uses for packing weather; no API key).
 * Returns null when the date is beyond the forecast range or the service fails:
 * callers plan without weather and say so.
 */

export type WeatherCondition = "clear" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm" | "unknown";

export type HourlyWeather = {
  time: string;
  condition: WeatherCondition;
  precipProbability: number | null;
  precipMm: number | null;
  tempC: number | null;
};

export type DailyOutlook = {
  date: string;
  condition: WeatherCondition;
  precipProbabilityMax: number | null;
  tempMaxC: number | null;
  tempMinC: number | null;
};

export type DayWeather = { hours: HourlyWeather[]; days: DailyOutlook[] };

/** Open-Meteo forecasts about 16 days ahead. */
const FORECAST_DAYS = 15;
const TIMEOUT_MS = 8000;

/** WMO weather interpretation codes, grouped. */
export function weatherCondition(code: number | null | undefined): WeatherCondition {
  if (code === null || code === undefined) return "unknown";
  if (code <= 1) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "unknown";
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`weather ${response.status}`);
  return response.json();
}

async function geocodeCity(city: string): Promise<Coords | null> {
  const data = (await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
  )) as { results?: { latitude?: number; longitude?: number }[] };
  const first = data.results?.[0];
  return first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude)
    ? { lat: first.latitude!, lng: first.longitude! }
    : null;
}

const at = <T,>(values: (T | null)[] | undefined, index: number): T | null => values?.[index] ?? null;

type ForecastResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    precipitation_probability?: (number | null)[];
    precipitation?: (number | null)[];
    weather_code?: (number | null)[];
  };
  daily?: {
    time?: string[];
    weather_code?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
  };
};

export async function fetchDayWeather(input: {
  city: string;
  coords?: Coords;
  /** YYYY-MM-DD of the day being planned. */
  date: string;
  /** Hours that ended before this time are left out. */
  fromTime: string;
  dayEnd: string;
  otherDates: string[];
  /** Trip-local today, YYYY-MM-DD. */
  today: string;
}): Promise<DayWeather | null> {
  const lastForecastDate = addDays(input.today, FORECAST_DAYS);
  if (input.date > lastForecastDate) return null;
  const otherDates = input.otherDates.filter((d) => d !== input.date && d <= lastForecastDate);
  const endDate = [input.date, ...otherDates].sort().at(-1)!;

  try {
    const coords = input.coords ?? (await geocodeCity(input.city));
    if (!coords) return null;
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(coords.lat));
    url.searchParams.set("longitude", String(coords.lng));
    url.searchParams.set("hourly", "temperature_2m,precipitation_probability,precipitation,weather_code");
    url.searchParams.set("daily", "weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min");
    url.searchParams.set("start_date", input.date);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("timezone", "auto");
    const data = (await getJson(url.toString())) as ForecastResponse;

    const from = toMinutes(input.fromTime) ?? 0;
    const until = toMinutes(input.dayEnd) ?? 24 * 60;
    const hours: HourlyWeather[] = [];
    (data.hourly?.time ?? []).forEach((stamp, index) => {
      if (stamp.slice(0, 10) !== input.date) return;
      const time = stamp.slice(11, 16);
      const start = toMinutes(time);
      if (start === null || start + 60 <= from || start > until) return;
      hours.push({
        time,
        condition: weatherCondition(at(data.hourly?.weather_code, index)),
        precipProbability: at(data.hourly?.precipitation_probability, index),
        precipMm: at(data.hourly?.precipitation, index),
        tempC: at(data.hourly?.temperature_2m, index),
      });
    });

    const days: DailyOutlook[] = [];
    (data.daily?.time ?? []).forEach((date, index) => {
      if (!otherDates.includes(date)) return;
      days.push({
        date,
        condition: weatherCondition(at(data.daily?.weather_code, index)),
        precipProbabilityMax: at(data.daily?.precipitation_probability_max, index),
        tempMaxC: at(data.daily?.temperature_2m_max, index),
        tempMinC: at(data.daily?.temperature_2m_min, index),
      });
    });
    return { hours, days };
  } catch (error) {
    console.warn("Day weather unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
