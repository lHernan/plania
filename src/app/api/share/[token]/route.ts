/**
 * GET /api/share/[token]
 *
 * Validates a share link and returns trip summary + role.
 * Public (no auth required). Returns whether acceptance requires login.
 */

import { NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    // Prefer service role (bypasses RLS). Fall back to anon client if the
    // service role key is not configured; the public-read RLS policy then
    // allows reading the link and the trip.
    let supabase;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const isServiceRole = !!serviceKey && serviceKey !== anonKey && !serviceKey.startsWith("sb_publishable_") && !serviceKey.startsWith("sb_anon_");
    if (isServiceRole) {
      supabase = getServiceRoleSupabase();
    } else {
      supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        anonKey!,
        { auth: { persistSession: false } }
      );
    }

    const { data: link, error: linkError } = await supabase
      .from("trip_share_links")
      .select("id, trip_id, role, email, expires_at, revoked_at, accepted_by, accepted_at")
      .eq("token", token)
      .maybeSingle();

    if (linkError || !link) {
      return NextResponse.json({ error: "Enlace no válido" }, { status: 404 });
    }

    if (link.revoked_at) {
      return NextResponse.json({ error: "Este enlace fue revocado" }, { status: 410 });
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json({ error: "Este enlace expiró" }, { status: 410 });
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, name, start_date, end_date, user_id")
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
      ownerId: trip.user_id,
      role: link.role,
      email: link.email,
      accepted: Boolean(link.accepted_by),
      acceptedAt: link.accepted_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}