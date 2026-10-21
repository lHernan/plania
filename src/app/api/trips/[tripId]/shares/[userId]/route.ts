/**
 * DELETE /api/trips/[tripId]/shares/[userId]
 *
 * Revokes a user's access to a trip.
 * Only the trip owner can call this.
 *
 * Response: { success: true }
 */

import { NextResponse } from "next/server";
import { getAuthClient } from "@/lib/supabase-server";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ tripId: string; userId: string }> }
) {
  try {
    const { tripId, userId } = await context.params;
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
        { error: "Solo el propietario puede revocar accesos" },
        { status: 403 }
      );
    }

    // Delete the share
    const { error: deleteError } = await supabase
      .from("trip_shares")
      .delete()
      .eq("trip_id", tripId)
      .eq("shared_with", userId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ tripId: string; userId: string }> }
) {
  try {
    const { tripId, userId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const role: unknown = body?.role;
    const normalizedRole = role === "editor" ? "editor" : "viewer";

    const supabase = getAuthClient(request);

    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

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
        { error: "Solo el propietario puede cambiar permisos" },
        { status: 403 }
      );
    }

    const { error: updateError } = await supabase
      .from("trip_shares")
      .update({ role: normalizedRole })
      .eq("trip_id", tripId)
      .eq("shared_with", userId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, role: normalizedRole });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
