import { NextResponse } from "next/server";

const SYSTEM_PROMPT = [
  "You are an AI assistant integrated into a travel planning application.",
  "Your task is to convert unstructured user text into a structured activity object that can be stored in a database.",
  "",
  "GOALS:",
  "1. Extract structured data from the text.",
  "2. Identify the place (POI), time, intent, and notes.",
  "3. Normalize the data into a JSON object.",
  "4. If no date is provided in the text, use the FALLBACK_DATE provided.",
  "5. If time is missing, set it as null.",
  "6. If the place is ambiguous, infer the most likely known location.",
  "7. Enrich the data when possible (category, estimated duration).",
  "",
  "RULES:",
  '- "title" should be short and user-friendly.',
  '- "category" must be one of: food, shopping, sightseeing, hotel, transport, reservation, photos, nightlife, other.',
  '- "notes" should contain extracted details like shopping lists.',
  "- Default durations: shopping=90min, food=75min, sightseeing=60min, other=60min.",
  "- If multiple distinct intents exist, return multiple array items.",
  "",
  "OUTPUT: Return ONLY a raw JSON object with NO markdown formatting, NO code blocks. EXACTLY this shape:",
  '{"activities":[{"title":"string","category":"string","location":"string","date":"YYYY-MM-DD","time":"HH:mm or null","duration_minutes":60,"notes":"string"}]}'
].join("\n");

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, fallbackDate } = body;

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const AILink = process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions";
    const AIKey = process.env.AI_API_KEY;
    const AIModel = process.env.AI_MODEL || "gpt-4o-mini";

    if (!AIKey) {
      return NextResponse.json({ error: "AI_API_KEY is missing in your environment configuration" }, { status: 500 });
    }

    const userMessage = "FALLBACK_DATE: " + fallbackDate + "\n\nTEXT TO PARSE:\n" + text;

    const res = await fetch(AILink, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + AIKey
      },
      body: JSON.stringify({
        model: AIModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("AI API Error:", errorText);
      return NextResponse.json({ error: "AI Provider error (" + res.status + "): " + errorText }, { status: 502 });
    }

    const data = await res.json();

    // Handle OpenAI-compatible response shape (works for Gemini OpenAI compat layer too)
    const content: string =
      data.choices?.[0]?.message?.content ||
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    console.log("AI content received:", content.substring(0, 300));

    // Extract the JSON object - find outermost { ... } regardless of any markdown wrapping
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd <= jsonStart) {
      console.error("No JSON found in AI output:", content);
      return NextResponse.json({ error: "AI returned no JSON. Raw: " + content.substring(0, 200) }, { status: 500 });
    }

    const extracted = content.slice(jsonStart, jsonEnd + 1);

    try {
      const parsed = JSON.parse(extracted);
      return NextResponse.json(parsed);
    } catch {
      console.error("JSON parse failed:", extracted);
      return NextResponse.json({ error: "AI JSON parse failed: " + extracted.substring(0, 200) }, { status: 500 });
    }

  } catch (error: any) {
    console.error("AI Import Route Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
