/**
 * GET /api/trips/[tripId]/shares
 *
 * Returns the list of users who have access to a trip.
 * Only the trip owner can call this.
 *
 * Response: { shares: TripShareUser[] }
 */

import { NextResponse } from "next/server";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";
import type { TripShareUser } from "@/lib/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await context.params;
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
        { error: "Solo el propietario puede ver los accesos" },
        { status: 403 }
      );
    }

    // Fetch all shares for this trip
    const { data: sharesData, error: sharesError } = await supabase
      .from("trip_shares")
      .select("id, shared_with, created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true });

    if (sharesError) {
      return NextResponse.json({ error: sharesError.message }, { status: 500 });
    }

    if (!sharesData || sharesData.length === 0) {
      return NextResponse.json({ shares: [] });
    }

    // Fetch user emails via admin client (batch)
    const adminSupabase = getServiceRoleSupabase();
    const { data: usersData, error: usersError } = await adminSupabase.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json({ error: "Error obteniendo usuarios" }, { status: 500 });
    }

    const userMap = new Map(usersData.users.map((u) => [u.id, u.email ?? ""]));

    const shares: TripShareUser[] = sharesData.map((row) => ({
      userId: row.shared_with,
      email: userMap.get(row.shared_with) ?? "Usuario desconocido",
      createdAt: row.created_at,
    }));

    return NextResponse.json({ shares });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
