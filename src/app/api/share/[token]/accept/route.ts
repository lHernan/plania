/**
 * POST /api/share/[token]/accept
 *
 * Accepts a share link for the authenticated user, granting them access
 * to the trip with the link's role. Idempotent.
 */

import { NextResponse } from "next/server";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const supabase = getAuthClient(request);

    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const isPublishable = !!serviceKey && (serviceKey.startsWith("sb_publishable_") || serviceKey.startsWith("sb_anon_"));
    if (!serviceKey || serviceKey === anonKey || isPublishable) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY no es la service role key (es una publishable/anon key). Usa la service_role secret del dashboard de Supabase." },
        { status: 500 }
      );
    }
    const adminSupabase = getServiceRoleSupabase();

    const { data: link, error: linkError } = await adminSupabase
      .from("trip_share_links")
      .select("id, trip_id, role, email, expires_at, revoked_at")
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

    // If the link targets a specific email, enforce it.
    if (link.email && caller.email?.toLowerCase() !== link.email.toLowerCase()) {
      return NextResponse.json(
        { error: "Este enlace está reservado para otro email" },
        { status: 403 }
      );
    }

    // Prevent self-accept by owner (no-op but safe)
    const { data: trip } = await adminSupabase
      .from("trips")
      .select("user_id")
      .eq("id", link.trip_id)
      .single();

    if (trip?.user_id === caller.id) {
      return NextResponse.json({ success: true, alreadyOwner: true, tripId: link.trip_id });
    }

    // Create share row (ignore duplicate)
    const { error: shareError } = await adminSupabase
      .from("trip_shares")
      .insert({ trip_id: link.trip_id, shared_with: caller.id, role: link.role });

    if (shareError && shareError.code !== "23505") {
      return NextResponse.json({ error: shareError.message }, { status: 500 });
    }

    // Mark link as accepted (only first acceptance)
    await adminSupabase
      .from("trip_share_links")
      .update({ accepted_by: caller.id, accepted_at: new Date().toISOString() })
      .eq("id", link.id)
      .is("accepted_by", null);

    return NextResponse.json({ success: true, tripId: link.trip_id, role: link.role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}