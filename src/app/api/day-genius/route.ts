import { NextResponse } from "next/server";
import { runAiPrompt } from "@/lib/ai/provider";
import { extractJsonObject } from "@/lib/ai/json-response";
import { getAuthClient } from "@/lib/supabase-server";
import { buildGeniusSystemPrompt, buildGeniusUserPrompt, parseGeniusRequest } from "@/lib/day-genius/prompt";
import { validateGeniusPlan } from "@/lib/day-genius/validate";
import { fetchDayWeather } from "@/lib/weather/day-forecast";

// The reply lists the whole rest of the day, and reasoning models spend output tokens first.
const GENIUS_MAX_TOKENS = 16000;

export async function POST(req: Request) {
  // Spends AI credits and reads trip details: signed-in users only.
  const { data: authData, error: authError } = await getAuthClient(req).auth.getUser();
  if (authError || !authData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const request = parseGeniusRequest(body);
  if (!request) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { context, today, lang, weatherCoords } = request;

  const weather = await fetchDayWeather({
    city: context.city,
    ...(weatherCoords ? { coords: weatherCoords } : {}),
    date: context.date,
    fromTime: context.windowStart,
    dayEnd: context.dayEnd,
    otherDates: context.otherDays.map((d) => d.date),
    today,
  });

  try {
    const content = await runAiPrompt(
      buildGeniusSystemPrompt(lang),
      buildGeniusUserPrompt(context, weather),
      { maxTokens: GENIUS_MAX_TOKENS },
    );
    const parsed = extractJsonObject<unknown>(content);
    if (!parsed) {
      console.error("Day genius: unparseable model output");
      return NextResponse.json({ error: "genius_failed" }, { status: 502 });
    }
    return NextResponse.json({ ...validateGeniusPlan(context, parsed), weather });
  } catch (error) {
    console.error("Day genius error:", error);
    return NextResponse.json({ error: "genius_failed" }, { status: 502 });
  }
}
