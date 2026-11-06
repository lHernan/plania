import { NextResponse } from "next/server";
import { buildCaptionPrompts, captionContext, cleanCaption, hasCaptionContext } from "@/lib/ai/memory-caption";
import { runAiPrompt } from "@/lib/ai/provider";
import { enforceAiQuota } from "@/lib/ai/quota";
import { readTripForCaller, summaryLang } from "@/lib/ai/trip-summary";
import { MEMORIES_TABLE } from "@/lib/memories-sync";
import { getAuthClient } from "@/lib/supabase-server";

/** Suggested photo caption from text only (the photo is never sent to the AI). */
export async function POST(request: Request) {
  // Spends AI credits: registered users only (not anonymous guests).
  const supabase = getAuthClient(request);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const lang = summaryLang(body.lang);
  const tripId = typeof body.tripId === "string" && body.tripId ? body.tripId : null;
  const memoryId = typeof body.memoryId === "string" && body.memoryId ? body.memoryId : null;
  if (memoryId && !tripId) return NextResponse.json({ error: "tripId is required with memoryId" }, { status: 400 });

  const context = captionContext(body);
  if (tripId) {
    // The caller's own client: a trip or memory they cannot read is never described.
    const access = await readTripForCaller(supabase, tripId, authData.user.id);
    if (!access.ok) {
      return NextResponse.json({ error: access.status === 404 ? "trip_not_found" : "forbidden" }, { status: access.status });
    }
    context.tripName = access.trip.name;

    if (memoryId) {
      const { data: memory } = await supabase
        .from(MEMORIES_TABLE)
        .select("activity_id, note")
        .eq("id", memoryId)
        .eq("trip_id", tripId)
        .maybeSingle();
      if (!memory) return NextResponse.json({ error: "memory_not_found" }, { status: 404 });
      const row = memory as { activity_id: string | null; note: string | null };
      context.note ??= captionContext({ note: row.note }).note;
      if (!context.activityTitle && row.activity_id) {
        const { data: activity } = await supabase.from("activities").select("title").eq("id", row.activity_id).maybeSingle();
        context.activityTitle = captionContext({ activityTitle: (activity as { title?: string } | null)?.title }).activityTitle;
      }
    }
  }
  if (!hasCaptionContext(context)) return NextResponse.json({ error: "nothing_to_describe" }, { status: 400 });

  const blocked = await enforceAiQuota(supabase, "caption");
  if (blocked) return blocked;

  let raw: string;
  try {
    const { system, user } = buildCaptionPrompts(context, lang);
    raw = await runAiPrompt(system, user, { tier: "fast", maxTokens: 400 });
  } catch {
    return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
  }

  const caption = cleanCaption(raw);
  if (!caption) return NextResponse.json({ error: "AI returned an empty caption" }, { status: 502 });
  return NextResponse.json({ caption });
}
