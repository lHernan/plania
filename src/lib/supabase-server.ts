/**
 * Server-side Supabase helpers for API Route Handlers.
 *
 * - getServerSupabase()        → client authenticated as the CURRENT USER (via cookies)
 * - getServiceRoleSupabase()   → admin client with SERVICE_ROLE_KEY (bypasses RLS)
 */

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Returns a Supabase client configured with the Authorization header from the request.
 * Since the frontend uses localStorage, it will pass the token as a Bearer header.
 */
export function getAuthClient(request: Request) {
  const authHeader = request.headers.get("Authorization");
  
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

/**
 * Returns a Supabase admin client with the Service Role Key.
 * Bypasses RLS — use only for privileged operations (e.g., looking up users by email).
 */
export function getServiceRoleSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
