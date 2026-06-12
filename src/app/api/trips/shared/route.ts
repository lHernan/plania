/**
 * GET /api/trips/shared
 *
 * Returns trips that other users have shared with the authenticated user.
 *
 * Response: { trips: SharedTripSummary[] }
 */

import { NextResponse } from "next/server";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";
import type { SharedTripSummary } from "@/lib/types";

type TripRow = {
  id: string;
  name: string;
  user_id: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
  is_favorite: boolean | null;
  trip_days: { count: number }[];
  activities: { count: number }[];
};

type ShareRow = {
  trip_id: string;
  created_at: string;
  trips: TripRow;
};

export async function GET(request: Request) {
  try {
    const supabase = getAuthClient(request);

    // Verify caller is authenticated
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Fetch shared trips with join on trips and counts
    const { data: sharesData, error: sharesError } = await supabase
      .from("trip_shares")
      .select(`
        trip_id,
        created_at,
        trips (
          id,
          name,
          user_id,
          start_date,
          end_date,
          created_at,
          is_favorite,
          trip_days(count),
          activities(count)
        )
      `)
      .eq("shared_with", caller.id)
      .order("created_at", { ascending: false });

    if (sharesError) {
      return NextResponse.json({ error: sharesError.message }, { status: 500 });
    }

    if (!sharesData || sharesData.length === 0) {
      return NextResponse.json({ trips: [] });
    }

    // Gather unique owner IDs to fetch their emails in one batch
    const shares = sharesData as unknown as ShareRow[];
    const ownerIds = [...new Set(shares.map((s) => s.trips.user_id))];

    const adminSupabase = getServiceRoleSupabase();
    const { data: usersData, error: usersError } = await adminSupabase.auth.admin.listUsers();

    const ownerEmailMap = new Map<string, string>();
    if (!usersError && usersData) {
      for (const u of usersData.users) {
        if (ownerIds.includes(u.id)) {
          ownerEmailMap.set(u.id, u.email ?? "");
        }
      }
    }

    const trips: SharedTripSummary[] = shares
      .filter((share) => share.trips)
      .map((share) => {
        const t = share.trips;
        return {
          id: t.id,
          name: t.name,
          startDate: t.start_date ?? undefined,
          endDate: t.end_date ?? undefined,
          createdAt: t.created_at ?? undefined,
          isFavorite: false, // invitees don't have their own favorite state
          dayCount: Number(t.trip_days?.[0]?.count ?? 0),
          activityCount: Number(t.activities?.[0]?.count ?? 0),
          ownerEmail: ownerEmailMap.get(t.user_id) ?? "",
          ownerId: t.user_id,
        };
      });

    return NextResponse.json({ trips });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
