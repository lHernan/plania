/**
 * POST /api/trips/[tripId]/share-link
 *
 * Creates a shareable link (public or email-targeted) for a trip.
 * Body: { role?: "viewer" | "editor", email?: string, expiresInDays?: number }
 *
 * Response: { token: string, url: string }
 */

import { NextResponse } from "next/server";
import { scheduleTripShareNotification } from "@/lib/share/notify";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const role = body?.role === "editor" ? "editor" : "viewer";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
    const expiresInDays = typeof body?.expiresInDays === "number" ? body.expiresInDays : 30;

    let step = "auth";
    const supabase = getAuthClient(request);

    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: "No autenticado", step }, { status: 401 });
    }

    step = "trip";
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id, name")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Viaje no encontrado", step, detail: tripError?.message }, { status: 404 });
    }

    if (trip.user_id !== caller.id) {
      return NextResponse.json(
        { error: "Solo el propietario puede compartir este viaje", step },
        { status: 403 }
      );
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Email inválido", step }, { status: 400 });
    }

    step = "token";
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    step = "insert";
    // Use the authenticated owner client: RLS policy trip_share_links_owner_all
    // allows the owner (created_by = auth.uid()) to insert. This avoids
    // depending on the service role key for link creation.
    const { error: insertError } = await supabase
      .from("trip_share_links")
      .insert({
        trip_id: tripId,
        token,
        role,
        email,
        created_by: caller.id,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("share-link insert error:", insertError);
      return NextResponse.json(
        { error: `No se pudo crear el enlace: ${insertError.message}`, step, code: insertError.code, details: insertError.details, hint: insertError.hint },
        { status: 500 }
      );
    }

    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";
    const url = `${origin}/share/${token}`;

    if (email) {
      // After the response: the invitation email never blocks or fails the share.
      scheduleTripShareNotification({
        tripId,
        tripName: trip.name ?? "tu viaje",
        inviteeEmail: email,
        ownerEmail: caller.email ?? "",
        shareUrl: url,
        role,
      });
    }

    return NextResponse.json({ token, url, role, email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("share-link unexpected error:", error);
    return NextResponse.json({ error: message, step: "unexpected" }, { status: 500 });
  }
}