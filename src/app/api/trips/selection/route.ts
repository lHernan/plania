import { NextResponse } from "next/server";
import { resolveTripSelection, type TripSelectionInput } from "@/lib/trip-selection";

function isTripSelectionInput(value: unknown): value is TripSelectionInput {
  if (!value || typeof value !== "object") return false;

  const input = value as Record<string, unknown>;
  if (typeof input.current_date !== "string" || !Array.isArray(input.trips)) return false;

  return input.trips.every((trip) => {
    if (!trip || typeof trip !== "object") return false;
    const item = trip as Record<string, unknown>;

    return (
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.start_date === "string" &&
      typeof item.end_date === "string" &&
      typeof item.is_favorite === "boolean" &&
      typeof item.created_at === "string"
    );
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!isTripSelectionInput(body)) {
      return NextResponse.json({ error: "Invalid trip selection request" }, { status: 400 });
    }

    return NextResponse.json(resolveTripSelection(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown trip selection error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
