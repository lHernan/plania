import { NextRequest, NextResponse } from "next/server";
import { geminiService } from "@/lib/services/gemini-service";
import { enforceAiQuota } from "@/lib/ai/quota";
import { getAuthClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  // Spends AI credits: registered users only (not anonymous guests).
  const supabase = getAuthClient(req);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { imageUri } = await req.json();

    if (!imageUri) {
      return NextResponse.json({ error: "No image URI provided" }, { status: 400 });
    }

    // Shares the "bookings" daily quota with booking extraction.
    const blocked = await enforceAiQuota(supabase, "bookings");
    if (blocked) return blocked;

    const regions = await geminiService.detectCodeRegions(imageUri);
    return NextResponse.json({ regions });
  } catch (error: any) {
    console.error("AI Code Detection API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
