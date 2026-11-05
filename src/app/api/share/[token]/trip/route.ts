/**
 * GET /api/share/[token]/trip
 *
 * Returns the full trip plan (days, activities, reservations) for a valid
 * share link, without requiring authentication. Read-only.
 *
 * The token is checked here with the service role client; RLS grants no reads through share
 * links. When the trip has memories shared with the whole trip, they are included (with
 * short-lived signed photo URLs) as `memories`, and the cover as `trip.coverUrl`.
 */

import { NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase-server";
import { hasServiceRoleKey } from "@/lib/share/grant";
import { checkShareLink, readPublicCoverUrl, readPublicMemories, SERVICE_ROLE_REQUIRED_ERROR } from "@/lib/share/public-trip";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;

    if (!hasServiceRoleKey()) {
      return NextResponse.json({ error: SERVICE_ROLE_REQUIRED_ERROR }, { status: 500 });
    }
    const supabase = getServiceRoleSupabase();

    const { data: linkRow, error: linkError } = await supabase
      .from("trip_share_links")
      .select("trip_id, role, revoked_at, expires_at")
      .eq("token", token)
      .maybeSingle();

    const checked = checkShareLink(linkError ? null : linkRow);
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: checked.status });
    }
    const link = checked.link;
    const tripId = link.trip_id;

    const [{ data: trip }, { data: days }, { data: activities }, { data: reservations }] = await Promise.all([
      supabase.from("trips").select("id, name, start_date, end_date").eq("id", tripId).single(),
      supabase.from("trip_days").select("*").eq("trip_id", tripId).order("date", { ascending: true }),
      supabase.from("activities").select("*").eq("trip_id", tripId).order("sort_order", { ascending: true }),
      supabase.from("critical_reservations").select("*").eq("trip_id", tripId),
    ]);

    if (!trip) {
      return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    const [memories, coverUrl] = await Promise.all([readPublicMemories(supabase, tripId), readPublicCoverUrl(supabase, tripId)]);

    // Without public memories or a cover the payload stays exactly as it was.
    return NextResponse.json({
      trip: { id: trip.id, name: trip.name, startDate: trip.start_date, endDate: trip.end_date, ...(coverUrl ? { coverUrl } : {}) },
      role: link.role,
      days: days ?? [],
      activities: activities ?? [],
      reservations: reservations ?? [],
      ...(memories.length > 0 ? { memories } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
