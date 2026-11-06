import { supabase } from "@/lib/supabase";
import type { TripPlan } from "@/lib/types";

/**
 * Sign in with Google or Apple (Supabase OAuth). The browser leaves the app for the provider and
 * comes back with the session in the URL (supabase-js reads it on load). A guest's anonymous id is
 * kept on the device before leaving, so their trips move to the account once they are back, the
 * same transfer the email sign-in makes (src/lib/transfer_anon_data.sql). An unsaved draft lives
 * only in memory, so it travels along too and comes back as the active draft, which is then saved
 * to the account like after an email sign-in.
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
export async function startOAuthSignIn(provider: OAuthProvider, now = Date.now(), draft: TripPlan | null = null): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  try {
    const anonId = user?.is_anonymous ? user.id : undefined;
    if (anonId || draft) localStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ ...(anonId ? { anonId } : {}), at: now, ...(draft ? { draft } : {}) }));
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

export type OAuthReturn = { transferred: boolean; draft: TripPlan | null };

/** A draft read back from storage: only something shaped like a trip is handed back. */
function asDraft(value: unknown): TripPlan | null {
  const draft = value as Partial<TripPlan> | null;
  return draft && typeof draft === "object" && typeof draft.id === "string" && typeof draft.name === "string" && Array.isArray(draft.days)
    ? (draft as TripPlan)
    : null;
}

/**
 * After coming back signed in, once: moves the guest's trips to `userId` and hands back the draft
 * that travelled along. The database function only lets the signed-in user receive data, and only
 * from an anonymous user.
 */
export async function completePendingOAuthTransfer(userId: string, now = Date.now()): Promise<OAuthReturn> {
  const nothing: OAuthReturn = { transferred: false, draft: null };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OAUTH_PENDING_KEY);
  } catch {
    return nothing;
  }
  if (!raw) return nothing;
  clearPending();

  let pending: { anonId?: unknown; at?: unknown; draft?: unknown };
  try {
    pending = JSON.parse(raw);
  } catch {
    return nothing;
  }
  const { anonId, at } = pending;
  if (typeof at !== "number" || now - at > PENDING_TTL_MS) return nothing;
  const draft = asDraft(pending.draft);
  if (typeof anonId !== "string" || anonId === userId) return { transferred: false, draft };

  const { error } = await supabase.rpc("transfer_anonymous_data", { p_anon_id: anonId, p_new_id: userId });
  if (error) console.warn("transfer_anonymous_data RPC error:", error.message);
  return { transferred: !error, draft };
}
