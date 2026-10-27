import { supabase } from "@/lib/supabase";

/** JSON headers plus the session token, for API routes that need the signed-in user. */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}
