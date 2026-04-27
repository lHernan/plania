import { NextRequest, NextResponse } from "next/server";
import { geminiService } from "@/lib/services/gemini-service";

export async function POST(req: NextRequest) {
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
