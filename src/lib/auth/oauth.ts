import { supabase } from "@/lib/supabase";

/**
 * Sign in with Google or Apple (Supabase OAuth). The browser leaves the app for the provider and
 * comes back with the session in the URL (supabase-js reads it on load). A guest's anonymous id is
 * kept on the device before leaving, so their trips move to the account once they are back, the
 * same transfer the email sign-in makes (src/lib/transfer_anon_data.sql).
 */

export type OAuthProvider = "google" | "apple";

const PROVIDERS: readonly OAuthProvider[] = ["google", "apple"];
export const OAUTH_PENDING_KEY = "tachao_oauth_pending";
/** A sign-in that has not come back by then was abandoned. */
const PENDING_TTL_MS = 30 * 60 * 1000;

/**
 * The providers to offer, from NEXT_PUBLIC_AUTH_PROVIDERS ("google,apple"). A provider is listed
 * only once it is enabled in Supabase, so a button never leads to a provider that is not set up.
 */
export function enabledOAuthProviders(): OAuthProvider[] {
  const configured = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "").split(",").map((value) => value.trim().toLowerCase());
  return PROVIDERS.filter((provider) => configured.includes(provider));
}

function clearPending() {
  try {
    localStorage.removeItem(OAUTH_PENDING_KEY);
  } catch {
    // Storage unavailable: nothing was kept.
  }
}

/** Leaves for the provider; it comes back to this same page. Returns the provider's error, if any. */
export async function startOAuthSignIn(provider: OAuthProvider, now = Date.now()): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  try {
    if (user?.is_anonymous) localStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ anonId: user.id, at: now }));
    else localStorage.removeItem(OAUTH_PENDING_KEY);
    // Signing in again: the cached session may be restored, as after an email sign-in.
    localStorage.removeItem("plania_logged_out");
  } catch {
    // Storage unavailable: the sign-in still works, the guest's trips just stay behind.
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}` },
  });
  if (error) {
    clearPending();
    return { error: error.message };
  }
  return { error: null };
}

/**
 * After coming back signed in: moves the guest's trips to `userId`, once. True when a transfer ran.
 * The database function only lets the signed-in user receive data, and only from an anonymous user.
 */
export async function completePendingOAuthTransfer(userId: string, now = Date.now()): Promise<boolean> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OAUTH_PENDING_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  clearPending();

  let pending: { anonId?: unknown; at?: unknown };
  try {
    pending = JSON.parse(raw);
  } catch {
    return false;
  }
  const { anonId, at } = pending;
  if (typeof anonId !== "string" || typeof at !== "number" || anonId === userId || now - at > PENDING_TTL_MS) return false;

  const { error } = await supabase.rpc("transfer_anonymous_data", { p_anon_id: anonId, p_new_id: userId });
  if (error) {
    console.warn("transfer_anonymous_data RPC error:", error.message);
    return false;
  }
  return true;
}
