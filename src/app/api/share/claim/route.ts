/**
 * POST /api/share/claim
 *
 * Grants the signed-in user every pending invitation sent to their email (share links created
 * with that email, after the account existed, that are not revoked, expired or accepted yet).
 * Called on sign-in, so an invitee sees the shared trip without having to open the link. Idempotent.
 */

import { NextResponse } from "next/server";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";
import { grantShareLink, hasServiceRoleKey, isLinkExpired, type ShareLinkRow } from "@/lib/share/grant";

export async function POST(request: Request) {
  try {
    const { data: { user: caller }, error: authError } = await getAuthClient(request).auth.getUser();
    if (authError || !caller || caller.is_anonymous) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    // An invitation by email only belongs to whoever proved they own that inbox.
    const email = caller.email?.trim().toLowerCase();
    if (!email || !caller.email_confirmed_at) return NextResponse.json({ tripIds: [] });
    if (!hasServiceRoleKey()) return NextResponse.json({ error: "Service role key not configured" }, { status: 500 });

    const admin = getServiceRoleSupabase();
    // Links store the email lowercased; exact match, never a LIKE pattern.
    const { data: links, error } = await admin
      .from("trip_share_links")
      .select("id, trip_id, role, email, expires_at, revoked_at, created_at")
      .eq("email", email)
      .is("revoked_at", null)
      .is("accepted_by", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const tripIds: string[] = [];
    // Only invitations sent to an account that already existed: whoever signs up later with an
    // invited address (sign-ups may be auto-confirmed) still needs the link from the email.
    const accountCreatedAt = Date.parse(caller.created_at ?? "");
    for (const link of (links ?? []) as (ShareLinkRow & { created_at?: string })[]) {
      if (isLinkExpired(link)) continue;
      if (!(Date.parse(link.created_at ?? "") > accountCreatedAt)) continue;
      const granted = await grantShareLink(admin, link, caller.id);
      if (granted.ok && !granted.alreadyOwner && !tripIds.includes(granted.tripId)) tripIds.push(granted.tripId);
    }
    return NextResponse.json({ tripIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
