import { NextResponse } from "next/server";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";
import type { ActivityComment } from "@/lib/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await context.params;
    const url = new URL(request.url);
    const activityId = url.searchParams.get("activityId");
    if (!activityId) {
      return NextResponse.json({ error: "activityId requerido" }, { status: 400 });
    }

    const authHeader = request.headers.get("Authorization");
    const supabase = getAuthClient(request);
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      console.log("[comments GET] 401 - authHeader present:", !!authHeader, "authError:", authError?.message);
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("activity_comments")
      .select("id, activity_id, trip_id, user_id, content, created_at")
      .eq("trip_id", tripId)
      .eq("activity_id", activityId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const emailMap = new Map<string, string>();
    emailMap.set(caller.id, caller.email ?? "");
    const otherIds = [...new Set((data ?? []).map((r) => r.user_id))].filter((uid) => uid !== caller.id);
    if (otherIds.length > 0) {
      try {
        const adminSupabase = getServiceRoleSupabase();
        const results = await Promise.all(
          otherIds.map(async (uid) => {
            try {
              const { data: u } = await adminSupabase.auth.admin.getUserById(uid);
              return [uid, u?.user?.email ?? ""] as const;
            } catch {
              return [uid, ""] as const;
            }
          })
        );
        for (const [uid, email] of results) emailMap.set(uid, email);
      } catch {
        // service role unavailable; leave emails empty for others
      }
    }

    const comments: ActivityComment[] = (data ?? []).map((row) => ({
      id: row.id,
      activityId: row.activity_id,
      tripId: row.trip_id,
      userId: row.user_id,
      userEmail: emailMap.get(row.user_id) ?? "",
      content: row.content,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ comments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> }
) {
  try {
    const { tripId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const activityId = body?.activityId;
    const content = typeof body?.content === "string" ? body.content.trim() : "";

    if (!activityId || !content) {
      return NextResponse.json({ error: "activityId y content requeridos" }, { status: 400 });
    }

    const authHeader = request.headers.get("Authorization");
    const supabase = getAuthClient(request);
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      console.log("[comments POST] 401 - authHeader present:", !!authHeader, "authError:", authError?.message);
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("activity_comments")
      .insert({ activity_id: activityId, trip_id: tripId, user_id: caller.id, content })
      .select("id, activity_id, trip_id, user_id, content, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      comment: {
        id: data.id,
        activityId: data.activity_id,
        tripId: data.trip_id,
        userId: data.user_id,
        userEmail: caller.email ?? "",
        content: data.content,
        createdAt: data.created_at,
      } as ActivityComment,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
