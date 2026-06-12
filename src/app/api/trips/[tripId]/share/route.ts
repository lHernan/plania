/**
 * POST /api/trips/[tripId]/share
 *
 * Shares a trip with another registered user by email.
 *
 * Body: { email: string }
 *
 * Responses:
 *  200 — shared successfully
 *  400 — bad request (missing email, self-share, already shared)
 *  403 — caller is not the trip owner
 *  404 — user with that email not found
 *  500 — server error
 */

import { NextResponse } from "next/server";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const email: unknown = body?.email;

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }

    const supabase = getAuthClient(request);

    // Verify caller is authenticated
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Verify caller is the trip owner
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 });
    }

    if (trip.user_id !== caller.id) {
      return NextResponse.json(
        { error: "Solo el propietario puede compartir este viaje" },
        { status: 403 }
      );
    }

    // Prevent self-sharing
    if (caller.email?.toLowerCase() === email.toLowerCase()) {
      return NextResponse.json(
        { error: "No puedes compartir el viaje contigo mismo" },
        { status: 400 }
      );
    }

    // Look up the target user by email (requires service role)
    const adminSupabase = getServiceRoleSupabase();
    const { data: usersData, error: usersError } = await adminSupabase.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json({ error: "Error buscando usuario" }, { status: 500 });
    }

    const targetUser = usersData.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (!targetUser) {
      return NextResponse.json(
        { error: "No existe ningún usuario registrado con ese email. Pídele que se registre primero en Plania." },
        { status: 404 }
      );
    }

    // Insert the share (UNIQUE constraint handles duplicates)
    const { error: shareError } = await supabase
      .from("trip_shares")
      .insert({ trip_id: tripId, shared_with: targetUser.id });

    if (shareError) {
      if (shareError.code === "23505") {
        // Unique constraint violation → already shared
        return NextResponse.json(
          { error: "Este viaje ya está compartido con ese usuario" },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: shareError.message }, { status: 500 });
    }

    // Trigger email notification via Edge Function (fire-and-forget)
    const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-trip-share`;
    fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        tripId,
        tripName: (trip as { id: string; user_id: string; name?: string }).name ?? "tu viaje",
        inviteeEmail: email,
        ownerEmail: caller.email,
      }),
    }).catch((err) => console.warn("notify-trip-share edge function error:", err));

    return NextResponse.json({ success: true, sharedWithEmail: email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
