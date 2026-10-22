/**
 * GET /api/share/[token]/trip
 *
 * Returns the full trip plan (days, activities, reservations) for a valid
 * share link, without requiring authentication. Read-only.
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

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase =
      serviceKey && serviceKey !== anonKey
        ? getServiceRoleSupabase()
        : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, { auth: { persistSession: false } });

    const { data: link, error: linkError } = await supabase
      .from("trip_share_links")
      .select("trip_id, role, revoked_at, expires_at")
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

    return NextResponse.json({
      trip: { id: trip.id, name: trip.name, startDate: trip.start_date, endDate: trip.end_date },
      role: link.role,
      days: days ?? [],
      activities: activities ?? [],
      reservations: reservations ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}