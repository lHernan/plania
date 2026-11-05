/**
 * GET /api/share/[token]
 *
 * Validates a share link and returns trip summary + role.
 * Public (no auth required). Returns whether acceptance requires login.
 * The token is checked with the service role client; RLS grants no reads through share links.
 */

import { NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase-server";
import { hasServiceRoleKey } from "@/lib/share/grant";
import { checkShareLink, SERVICE_ROLE_REQUIRED_ERROR } from "@/lib/share/public-trip";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    // Share links are checked only here, with the service role: RLS grants no reads through
    // links, so there is no anon-key fallback.
    if (!hasServiceRoleKey()) {
      return NextResponse.json({ error: SERVICE_ROLE_REQUIRED_ERROR }, { status: 500 });
    }
    const supabase = getServiceRoleSupabase();

    const { data: linkRow, error: linkError } = await supabase
      .from("trip_share_links")
      .select("trip_id, role, expires_at, revoked_at, accepted_by")
      .eq("token", token)
      .maybeSingle();

    const checked = checkShareLink(linkError ? null : linkRow);
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: checked.status });
    }
    const link = checked.link;

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, name, start_date, end_date")
      .eq("id", link.trip_id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    return NextResponse.json({
      tripId: trip.id,
      tripName: trip.name,
      startDate: trip.start_date,
      endDate: trip.end_date,
      role: link.role,
      // Who accepted, the invited email and the owner id stay private: anyone with the link sees this.
      accepted: Boolean(link.accepted_by),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}