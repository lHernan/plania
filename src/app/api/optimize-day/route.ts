import { NextResponse } from "next/server";
import { dayGeniusService } from "@/lib/services/day-genius";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { date, activities } = body;

    if (!activities || !Array.isArray(activities)) {
      return NextResponse.json({ error: "Invalid activities payload" }, { status: 400 });
    }

    const optimizedActivities = await dayGeniusService.optimizeDay(date || "unknown-date", activities);

    return NextResponse.json({ optimizedActivities });
  } catch (error: any) {
    console.error("Optimize Day Route Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
