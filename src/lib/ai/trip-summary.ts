import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlaceholderCity } from "@/lib/day-genius/context";
import { isMissingMemoriesTable, MEMORIES_TABLE } from "@/lib/memories-sync";

/**
 * "Resume mi viaje" (S4). Everything here reads with the caller's own Supabase client, so
 * RLS decides which memories exist for them (S2): hidden memories never reach the AI.
 * The AI receives text only: no photos, no emails, no author ids.
 */

export type SummaryLang = "es" | "en";

export type TripRow = {
  id: string;
  name: string;
  user_id: string;
  start_date: string | null;
  end_date: string | null;
  travel_context: unknown;
};

export type TripAccess = { ok: true; trip: TripRow } | { ok: false; status: 403 | 404 };

const NOTE_MAX = 400;
const MEMORIES_MAX = 80;

export function summaryLang(value: unknown): SummaryLang {
  return value === "es" ? "es" : "en";
}

/** The trip as the caller sees it: 404 when RLS hides it, 403 when they are neither its owner nor a member. */
export async function readTripForCaller(client: SupabaseClient, tripId: string, callerId: string): Promise<TripAccess> {
  const { data: trip, error } = await client
    .from("trips")
    .select("id, name, user_id, start_date, end_date, travel_context")
    .eq("id", tripId)
    .maybeSingle();
  if (error || !trip) return { ok: false, status: 404 };
  const row = trip as TripRow;
  if (row.user_id === callerId) return { ok: true, trip: row };

  const { data: share } = await client
    .from("trip_shares")
    .select("trip_id")
    .eq("trip_id", tripId)
    .eq("shared_with", callerId)
    .maybeSingle();
  return share ? { ok: true, trip: row } : { ok: false, status: 403 };
}

type DayRow = { id: string; date: string; city: string };
type ActivityRow = { id: string; day_id: string; title: string; state: string; time?: string | null };
type MemoryRow = { activity_id: string | null; note: string | null; rating: number | null };

/** One memory as the AI sees it: what it is about, the note and the rating. Nothing else. */
export type SummaryMemory = { activity: string | null; note: string | null; rating: number | null };

export type TripSummaryInput = {
  tripName: string;
  cities: string[];
  days: Array<{ day: string; city: string | null; completed: string[]; memories: SummaryMemory[] }>;
  tripMemories: SummaryMemory[];
};

const cleanNote = (note: string | null) => (note?.trim() ? note.trim().slice(0, NOTE_MAX) : null);

function toSummaryMemory(row: MemoryRow, activityTitle: string | null): SummaryMemory {
  return {
    activity: activityTitle,
    note: cleanNote(row.note),
    rating: typeof row.rating === "number" ? row.rating : null,
  };
}

/** Days, completed activities and visible memories of the trip; null when they cannot be read. */
export async function loadTripSummaryInput(client: SupabaseClient, trip: TripRow, lang: SummaryLang): Promise<TripSummaryInput | null> {
  const [days, activities, memories] = await Promise.all([
    client.from("trip_days").select("id, date, city").eq("trip_id", trip.id).order("date", { ascending: true }),
    client.from("activities").select("id, day_id, title, state, time").eq("trip_id", trip.id).order("sort_order", { ascending: true }),
    client.from(MEMORIES_TABLE).select("activity_id, note, rating").eq("trip_id", trip.id).order("created_at", { ascending: true }),
  ]);
  if (days.error || activities.error) return null;
  // Before the memories migration there are simply no memories.
  if (memories.error && !isMissingMemoriesTable(memories.error)) return null;

  // Read straight from the stored context: a context that fails full validation must not leak placeholder dates.
  const context = trip.travel_context;
  const undated = typeof context === "object" && context !== null && (context as { undated?: unknown }).undated === true;
  const dayRows = (days.data ?? []) as DayRow[];
  const activityRows = (activities.data ?? []) as ActivityRow[];
  const memoryRows = ((memories.error ? [] : memories.data ?? []) as MemoryRow[]).slice(0, MEMORIES_MAX);
  const activityById = new Map(activityRows.map((activity) => [activity.id, activity]));
  const dayIds = new Set(dayRows.map((day) => day.id));

  const placed = new Set<MemoryRow>();
  const result: TripSummaryInput["days"] = dayRows.map((day, index) => {
    const dayActivities = activityRows.filter((activity) => activity.day_id === day.id);
    const dayMemories = memoryRows.filter((memory) => {
      const activity = memory.activity_id ? activityById.get(memory.activity_id) : undefined;
      return activity?.day_id === day.id;
    });
    dayMemories.forEach((memory) => placed.add(memory));
    return {
      // Undated trips keep placeholder dates: the AI only gets the day number.
      day: undated ? `${lang === "es" ? "Día" : "Day"} ${index + 1}` : day.date,
      city: isPlaceholderCity(day.city ?? "") ? null : day.city,
      completed: dayActivities.filter((activity) => activity.state === "completed").map((activity) => activity.title),
      memories: dayMemories.map((memory) => toSummaryMemory(memory, activityById.get(memory.activity_id ?? "")?.title ?? null)),
    };
  });

  const cities = [...new Set(result.map((day) => day.city).filter((city): city is string => Boolean(city)))];
  const tripMemories = memoryRows
    .filter((memory) => !placed.has(memory))
    .map((memory) => {
      const activity = memory.activity_id ? activityById.get(memory.activity_id) : undefined;
      return toSummaryMemory(memory, activity && dayIds.has(activity.day_id) ? activity.title : null);
    });

  return {
    tripName: trip.name,
    cities,
    days: result.filter((day) => day.completed.length > 0 || day.memories.length > 0),
    tripMemories,
  };
}

export function buildTripSummaryPrompts(input: TripSummaryInput, lang: SummaryLang) {
  const language = lang === "es" ? "Spanish" : "English";
  const system = [
    "You are Tachi, a warm travel companion. Write a short story of a trip that has ended, from the traveler's own records.",
    `Write in ${language}, in 120 to 200 words, as two or three plain paragraphs.`,
    "Plain text only: no markdown, no headings, no lists, no bold, no emojis.",
    "Use only the facts provided: the cities, the completed activities and the travelers' notes and ratings. Never invent places, people or events.",
    "Do not name or describe people; speak to the traveler as \"you\".",
  ].join("\n");
  const user = `Trip records (JSON):\n${JSON.stringify(input)}`;
  return { system, user };
}

/** Plain paragraphs: strips the markdown a model may add anyway. */
export function cleanSummaryText(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, "")
        .replace(/^\s*(?:[-*•]|\d+\.)\s+/, "")
        // Emphasis markers only around words, so "#5", "snake_case" or "4*" in prose survive.
        .replace(/(?<!\w)(\*\*|__)(\S(?:.*?\S)?)\1(?!\w)/g, "$2")
        .replace(/(?<!\w)(\*|_)(\S(?:.*?\S)?)\1(?!\w)/g, "$2")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
