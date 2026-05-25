import { NextResponse } from "next/server";

const SYSTEM_PROMPT = [
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
  "OUTPUT: Return ONLY a raw JSON object with NO markdown formatting, NO code blocks. EXACTLY this shape:",
  '{"activities":[{"title":"string","category":"string","location":"string","date":"YYYY-MM-DD","time":"HH:mm","duration_minutes":60,"notes":"string","time_confidence":0.85,"time_inferred":true}]}'
].join("\n");

interface ProviderConfig {
  url: string;
  key: string;
  models: string; // Comma separated list
}

async function callAI(url: string, key: string, model: string, payload: any) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key
    },
    body: JSON.stringify({
      model: model,
      messages: payload,
      temperature: 0.1,
      max_tokens: 4000
    })
  });
}

async function tryModelsForProvider(config: ProviderConfig, payload: any) {
  const modelList = config.models.split(",").map(m => m.trim()).filter(Boolean);
  let lastResponse: Response | null = null;

  for (const model of modelList) {
    if (!model) continue;
    
    console.log("Attempting request with model: " + model + " (" + config.url + ")");
    try {
      const res = await callAI(config.url, config.key, model, payload);
      
      if (res.ok) {
        return { success: true, response: res };
      }

      lastResponse = res;
      const errText = await res.clone().text();
      console.warn("Model " + model + " failed with status " + res.status + ": " + errText);

      // If it's a 4xx error (except 429/408), it's likely a config/auth issue, don't keep trying models for this provider
      if (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) {
        return { success: false, response: res };
      }
      
      // If server is busy or error, continue to next model in the list
    } catch (e) {
      console.error("Fetch error for model " + model + ":", e);
    }
  }

  return { success: false, response: lastResponse };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, fallbackDate } = body;

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const payload = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "FALLBACK_DATE: " + fallbackDate + "\n\nTEXT TO PARSE:\n" + text }
    ];

    // 1. PRIMARY PROVIDER
    const primaryConfig = {
      url: process.env.AI_API_URL || "",
      key: process.env.AI_API_KEY || "",
      models: process.env.AI_MODEL || "gpt-4o-mini"
    };

    if (!primaryConfig.key || !primaryConfig.url) {
      return NextResponse.json({ error: "Primary AI configuration missing (API_URL/KEY)" }, { status: 500 });
    }

    let result = await tryModelsForProvider(primaryConfig, payload);

    // 2. FALLBACK PROVIDER (If primary completely failed with recoverable server errors)
    if (!result.success && result.response && [500, 502, 503, 504, 429].includes(result.response.status)) {
      const fallbackConfig = {
        url: process.env.AI_FALLBACK_API_URL || "",
        key: process.env.AI_FALLBACK_API_KEY || "",
        models: process.env.AI_FALLBACK_MODEL || ""
      };

      if (fallbackConfig.key && fallbackConfig.url && fallbackConfig.models) {
        console.warn("Primary provider exhausted or failed. Switching to FALLBACK provider...");
        result = await tryModelsForProvider(fallbackConfig, payload);
      }
    }

    const res = result.response;
    if (!result.success || !res) {
      const errorText = res ? await res.text() : "Unknown error";
      const status = res ? res.status : 502;
      console.error("AI Import final failure:", errorText);
      return NextResponse.json({ error: "AI Provider error (" + status + "): " + errorText }, { status: 502 });
    }

    const data = await res.json();
    const content: string =
      data.choices?.[0]?.message?.content ||
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd <= jsonStart) {
      return NextResponse.json({ error: "AI returned no JSON. Raw: " + content.substring(0, 200) }, { status: 500 });
    }

    const extracted = content.slice(jsonStart, jsonEnd + 1);

    try {
      const parsed = JSON.parse(extracted);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json({ error: "AI JSON parse failed: " + extracted.substring(0, 200) }, { status: 500 });
    }

  } catch (error: any) {
    console.error("AI Import Route Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
