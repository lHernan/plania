/**
 * POST /api/share/[token]/accept
 *
 * Accepts a share link for the authenticated user, granting them access
 * to the trip with the link's role. Idempotent.
 */

import { NextResponse } from "next/server";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";
import { grantShareLink, hasServiceRoleKey, isLinkExpired, type ShareLinkRow } from "@/lib/share/grant";

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

    if (!hasServiceRoleKey()) {
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

    if (isLinkExpired(link)) {
      return NextResponse.json({ error: "Este enlace expiró" }, { status: 410 });
    }

    // If the link targets a specific email, enforce it.
    if (link.email && caller.email?.toLowerCase() !== link.email.toLowerCase()) {
      return NextResponse.json(
        { error: "Este enlace está reservado para otro email" },
        { status: 403 }
      );
    }

    const granted = await grantShareLink(adminSupabase, link as ShareLinkRow, caller.id);
    if (!granted.ok) return NextResponse.json({ error: granted.error }, { status: 500 });
    if (granted.alreadyOwner) return NextResponse.json({ success: true, alreadyOwner: true, tripId: granted.tripId });
    return NextResponse.json({ success: true, tripId: granted.tripId, role: link.role });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}