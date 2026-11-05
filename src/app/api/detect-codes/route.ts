import { NextRequest, NextResponse } from "next/server";
import { geminiService } from "@/lib/services/gemini-service";
import { getAuthClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  // Spends AI credits: registered users only (not anonymous guests).
  const { data: authData, error: authError } = await getAuthClient(req).auth.getUser();
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { imageUri } = await req.json();

    if (!imageUri) {
      return NextResponse.json({ error: "No image URI provided" }, { status: 400 });
    }

    const regions = await geminiService.detectCodeRegions(imageUri);
    return NextResponse.json({ regions });
  } catch (error: any) {
    console.error("AI Code Detection API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
