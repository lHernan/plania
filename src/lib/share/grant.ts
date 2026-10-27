import type { getServiceRoleSupabase } from "@/lib/supabase-server";

type AdminClient = ReturnType<typeof getServiceRoleSupabase>;

export type ShareLinkRow = {
  id: string;
  trip_id: string;
  role: "viewer" | "editor";
  email: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export const isLinkExpired = (link: Pick<ShareLinkRow, "expires_at">) => Boolean(link.expires_at && new Date(link.expires_at) < new Date());

/** The service role key is required: a publishable/anon key cannot write trip_shares for someone else. */
export function hasServiceRoleKey(): boolean {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isPublishable = !!serviceKey && (serviceKey.startsWith("sb_publishable_") || serviceKey.startsWith("sb_anon_"));
  return Boolean(serviceKey) && serviceKey !== anonKey && !isPublishable;
}

/**
 * Gives the caller access to the link's trip with the link's role (idempotent) and marks the
 * link as accepted. The trip owner gets nothing new. Callers check revocation, expiry and email.
 */
export async function grantShareLink(
  admin: AdminClient,
  link: ShareLinkRow,
  callerId: string,
): Promise<{ ok: true; tripId: string; alreadyOwner: boolean } | { ok: false; error: string }> {
  const { data: trip } = await admin.from("trips").select("user_id").eq("id", link.trip_id).single();
  if (trip?.user_id === callerId) return { ok: true, tripId: link.trip_id, alreadyOwner: true };

  const { error: shareError } = await admin
    .from("trip_shares")
    .insert({ trip_id: link.trip_id, shared_with: callerId, role: link.role });
  if (shareError && shareError.code !== "23505") return { ok: false, error: shareError.message };

  // Only the first acceptance is recorded.
  await admin
    .from("trip_share_links")
    .update({ accepted_by: callerId, accepted_at: new Date().toISOString() })
    .eq("id", link.id)
    .is("accepted_by", null);

  return { ok: true, tripId: link.trip_id, alreadyOwner: false };
}
