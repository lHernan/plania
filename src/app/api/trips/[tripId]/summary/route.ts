import { NextResponse } from "next/server";
import { runAiPrompt } from "@/lib/ai/provider";
import { enforceAiQuota } from "@/lib/ai/quota";
import {
  buildTripSummaryPrompts,
  cleanSummaryText,
  loadTripSummaryInput,
  readTripForCaller,
  summaryLang,
} from "@/lib/ai/trip-summary";
import { getAuthClient } from "@/lib/supabase-server";

/**
 * "Resume mi viaje": a short story of the trip from what the caller can see. Reads only with
 * the caller's own client (never the service role), so RLS hides memories they may not see.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  // Spends AI credits: registered users only (not anonymous guests).
  const supabase = getAuthClient(request);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tripId } = await params;
  const body = (await request.json().catch(() => ({}))) as { lang?: unknown };
  const lang = summaryLang(body?.lang);

  const access = await readTripForCaller(supabase, tripId, authData.user.id);
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? "trip_not_found" : "forbidden" }, { status: access.status });
  }

  const input = await loadTripSummaryInput(supabase, access.trip, lang);
  if (!input) return NextResponse.json({ error: "trip_unavailable" }, { status: 500 });

  const blocked = await enforceAiQuota(supabase, "summary");
  if (blocked) return blocked;

  let raw: string;
  try {
    const { system, user } = buildTripSummaryPrompts(input, lang);
    raw = await runAiPrompt(system, user, { maxTokens: 1500 });
  } catch {
    return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
  }

  const summary = cleanSummaryText(raw);
  if (!summary) return NextResponse.json({ error: "AI returned an empty summary" }, { status: 502 });
  return NextResponse.json({ summary });
}
