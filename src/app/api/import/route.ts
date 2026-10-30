import { NextResponse } from "next/server";
import { LONG_REPLY_TIMEOUT_MS, runAiPrompt } from "@/lib/ai/provider";
import { getAuthClient } from "@/lib/supabase-server";
import { extractJsonObject } from "@/lib/ai/json-response";
import { buildPlanningAddendum, buildPlanningUserPrompt, parsePlanningInput } from "@/lib/bookings/planning-prompt";

// A whole-trip plan is a long JSON reply, and reasoning models spend output tokens before
// answering: with the default budget the reply came back truncated (finish_reason "length").
const PLANNING_MAX_TOKENS = 16000;

function buildSystemPrompt(lang: string) {
  const langRule = lang === "es"
    ? '- IMPORTANT: All "title" and "notes" values MUST be written in Spanish.'
    : '- Write all "title" and "notes" values in English.';

  return [
  "You are an AI assistant integrated into a travel planning application.",
  "Your task is to convert unstructured user text into a structured activity list with realistic, context-aware schedules.",
  "",
  "GOALS:",
  "1. Extract structured data from the text.",
  "2. Identify the place (POI), time, intent, and notes.",
  "3. Normalize the data into a JSON object.",
  "4. If no date is provided in the text, use the FALLBACK_DATE provided.",
  "5. If a time is missing, you MUST infer a realistic and context-aware start time based on travel heuristics (NEVER default to 12:00 PM or the same hour for all activities).",
  "6. If the place is ambiguous, infer the most likely known location.",
  "7. Enrich the data when possible (category, estimated duration).",
  "",
  "INTELLIGENT SCHEDULING RULES:",
  "1. RESPECT EXPLICIT TIMES:",
  "   - If the user specifies a time (e.g., 'Arrival at 9:45', 'Lunch at 13:00'), always preserve it exactly. Never overwrite user-defined schedules.",
  "   - Set 'time_inferred' as false and 'time_confidence' as 1.0 for activities with explicitly specified times.",
  "",
  "2. INFER REALISTIC TIMES WHEN MISSING:",
  "   - When no time is specified, you must calculate a logical, realistic start time and mark 'time_inferred' as true, with a 'time_confidence' score (e.g., between 0.6 and 0.95 depending on the strength of context clues).",
  "   - Sequence of events: Preserve the order in which the user describes activities. Activities should flow logically chronologically from morning to night.",
  "   - Chronological continuity: Use (previous activity start time + duration + travel buffer) to schedule the next activity. Do not overlap activities.",
  "",
  "3. ACTIVITY HEURISTICS:",
  "   - Transportation/Arrival: Airport/train arrival -> use exact provided arrival time. Hotel check-in/transfer -> estimate based on travel time from arrival (e.g., arrival at 09:45 -> check-in at 10:45 or 11:00).",
  "   - Meals: Breakfast (07:00–10:00), Brunch (10:00–12:00), Lunch (12:00–14:30), Snack/coffee/dessert (context-aware between meals), Dinner (19:00–22:00).",
  "   - Sightseeing: Plazas, walking areas, museums, landmarks -> schedule after meals or between activities. Add realistic transition/walking buffers.",
  "   - Night activities: If the text contains words like 'at night', 'night walk', 'evening', 'sunset', 'night view', schedule the activity after 19:00 (e.g. 'Gran Via by night' must never appear in the afternoon).",
  "",
  "4. SUGGESTED DEFAULT DURATIONS:",
  "   - Hotel check-in: 30–60 min",
  "   - Lunch/dinner: 60–90 min",
  "   - Dessert/chocolate shop/café: 20–45 min",
  "   - Walking sightseeing: 60–120 min",
  "   - Major attractions: context-based",
  "",
  "5. TRAVEL BUFFERS & LOGISTICS:",
  "   - Add realistic transfer/travel time between locations (e.g., 15–45 minutes depending on typical proximity).",
  "   - Avoid consecutive activities at impossible times.",
  "",
  "RULES FOR OUTPUT FIELDS:",
  '- "title" should be short and user-friendly.',
  '- "category" must be one of: food, shopping, sightseeing, hotel, transport, reservation, photos, nightlife, other.',
  '- "notes" should contain extracted details like shopping lists.',
  '- "time" must be a string formatted as "HH:mm". Always compute a realistic time if missing (NEVER return null).',
  '- "time_confidence" must be a float between 0.0 and 1.0 (1.0 for explicit user-specified times, and 0.5 to 0.95 for inferred times).',
  '- "time_inferred" must be a boolean (true if the time was inferred/suggested, false if the user explicitly provided it).',
  "- If multiple distinct intents exist in the input text, return multiple array items.",
  "",
  langRule,
  "",
  "OUTPUT: Return ONLY a raw JSON object with NO markdown formatting, NO code blocks. EXACTLY this shape:",
  '{"activities":[{"title":"string","category":"string","location":"string","date":"YYYY-MM-DD","time":"HH:mm","duration_minutes":60,"notes":"string","time_confidence":0.85,"time_inferred":true}]}'
].join("\n");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, fallbackDate, lang } = body;

    // Planning mode ("Generate itinerary"): same importer, prompt and schema, plus trip context.
    if (body?.planning !== undefined && body?.planning !== null) {
      // Planning sends the whole trip context and spends AI credits: signed-in users only.
      // (The plain text import keeps its existing, unauthenticated behavior.)
      const { data: authData, error: authError } = await getAuthClient(req).auth.getUser();
      if (authError || !authData?.user) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const planning = parsePlanningInput(body.planning);
      if (!planning) {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
      }
      const resolvedLang = lang || "en";
      const content = await runAiPrompt(
        buildSystemPrompt(resolvedLang) + "\n\n" + buildPlanningAddendum(resolvedLang),
        buildPlanningUserPrompt(planning.context, planning.request),
        { maxTokens: PLANNING_MAX_TOKENS, timeoutMs: LONG_REPLY_TIMEOUT_MS },
      );
      const parsed = extractJsonObject<{ activities?: unknown; conflicts?: unknown }>(content);
      if (!parsed) {
        return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
      }
      return NextResponse.json(parsed);
    }

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const content = await runAiPrompt(
      buildSystemPrompt(lang || "en"),
      "FALLBACK_DATE: " + fallbackDate + "\n\nTEXT TO PARSE:\n" + text,
    );
    const parsed = extractJsonObject<{ activities?: unknown }>(content);
    if (!parsed) {
      return NextResponse.json({ error: "AI returned invalid JSON" }, { status: 500 });
    }

    return NextResponse.json(parsed);

  } catch (error: unknown) {
    console.error("AI Import Route Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI import failed" }, { status: 500 });
  }
}
