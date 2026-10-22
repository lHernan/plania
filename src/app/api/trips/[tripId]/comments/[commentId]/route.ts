import { NextResponse } from "next/server";
import { getAuthClient } from "@/lib/supabase-server";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ tripId: string; commentId: string }> }
) {
  try {
    const { tripId, commentId } = await context.params;
    const supabase = getAuthClient(request);

    const { data: { user: caller }, error: authError } = await supabase.auth.getUser();
    if (authError || !caller) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { error } = await supabase
      .from("activity_comments")
      .delete()
      .eq("id", commentId)
      .eq("trip_id", tripId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
