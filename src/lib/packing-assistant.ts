import type {
  PackingCategory,
  PackingList,
  TripDay,
  TravelContext,
  WeatherSummary,
  ActivityCategory,
} from "@/lib/types";

// ─── Activity Breakdown ──────────────────────────────────────────────────────

export function buildActivityBreakdown(days: TripDay[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const day of days) {
    for (const activity of day.activities) {
      const cat = activity.category as ActivityCategory;
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  return counts;
}

// ─── AI Prompts ──────────────────────────────────────────────────────────────

export function buildPackingSystemPrompt(lang: string): string {
  const langInstruction =
    lang === "es"
      ? "IMPORTANT: All category names, item names, and reasons MUST be written in Spanish."
      : "Write all category names, item names, and reasons in English.";

  return `You are a practical travel packing assistant. Given a trip's details — destinations, weather, activities, duration, and luggage constraints — return a JSON object with smart packing recommendations.

Rules:
- Be realistic about luggage capacity. Prioritize versatile items.
- Group items into clear categories (e.g. "Clothing", "Toiletries", "Tech", "Documents", "Accessories").
- Each item must have: name (string), quantity (number), reason (string — brief justification).
- Reason should reference weather, activities, or constraints when relevant.
- Do NOT include items the traveler obviously has (phone, wallet, passport) unless weather/activity makes a specific version relevant.
- Keep the list between 20-40 items total.
- ${langInstruction}
- Respond ONLY with a JSON object, no markdown, no explanation.

Response format:
{
  "categories": [
    {
      "name": "Category Name",
      "items": [
        { "name": "Item", "quantity": 1, "reason": "Brief reason" }
      ]
    }
  ]
}`;
}

export type PackingPromptInput = {
  cities: string[];
  weatherSummaries: WeatherSummary[];
  activityBreakdown: Record<string, number>;
  luggageDescription: string;
  durationDays: number;
  travelerCount: number;
  lang: string;
};

export function buildPackingUserPrompt(input: PackingPromptInput): string {
  const weatherLines = input.weatherSummaries
    .map(
      (w) =>
        `- ${w.city}: ${w.tempMinC}°C to ${w.tempMaxC}°C, rain chance ${w.rainProbabilityMax}%`,
    )
    .join("\n");

  const activityLines = Object.entries(input.activityBreakdown)
    .map(([cat, count]) => `- ${cat}: ${count} activities`)
    .join("\n");

  return `Trip: ${input.durationDays} days across ${input.cities.join(", ")}
Travelers: ${input.travelerCount}
Luggage: ${input.luggageDescription}

Weather forecast:
${weatherLines || "- No weather data available"}

Activity breakdown:
${activityLines || "- No activities planned yet"}

Generate a packing list optimized for this trip.`;
}

// ─── Luggage Description ─────────────────────────────────────────────────────

export function describeLuggage(ctx?: TravelContext): string {
  const carryOn = ctx?.luggage?.carryOnBags ?? 1;
  const checked = ctx?.luggage?.checkedBags ?? 0;
  const parts: string[] = [];
  if (carryOn > 0) parts.push(`${carryOn} carry-on bag${carryOn > 1 ? "s" : ""}`);
  if (checked > 0) parts.push(`${checked} checked bag${checked > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" + ") : "1 carry-on bag (default)";
}

// ─── localStorage Helpers ────────────────────────────────────────────────────

const STORAGE_PREFIX = "plania_packing_";

export function loadPackingList(tripId: string): PackingList | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${tripId}`);
    return raw ? (JSON.parse(raw) as PackingList) : null;
  } catch {
    return null;
  }
}

export function savePackingList(list: PackingList): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${list.tripId}`, JSON.stringify(list));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

// ─── Unique Cities ───────────────────────────────────────────────────────────

export function getUniqueCities(days: TripDay[]): string[] {
  const seen = new Set<string>();
  const cities: string[] = [];
  for (const day of days) {
    const lower = day.city.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      cities.push(day.city);
    }
  }
  return cities;
}
