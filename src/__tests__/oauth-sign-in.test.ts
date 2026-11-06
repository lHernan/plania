// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// S2: sign in with Google or Apple. The browser leaves the app for the provider, so a guest's
// anonymous id is kept on the device and their trips move to the account when they come back.
const auth = vi.hoisted(() => ({
  user: null as { id: string; is_anonymous?: boolean } | null,
  oauthError: null as { message: string } | null,
  oauthCalls: [] as unknown[],
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  rpcError: null as { message: string } | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: auth.user }, error: null }),
      signInWithOAuth: async (args: unknown) => {
        auth.oauthCalls.push(args);
        return { data: {}, error: auth.oauthError };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      auth.rpcCalls.push([fn, args]);
      return { data: 3, error: auth.rpcError };
    },
  },
}));

const { completePendingOAuthTransfer, enabledOAuthProviders, startOAuthSignIn, OAUTH_PENDING_KEY } = await import("@/lib/auth/oauth");

beforeEach(() => {
  auth.user = null;
  auth.oauthError = null;
  auth.oauthCalls = [];
  auth.rpcCalls = [];
  auth.rpcError = null;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/trips/t1?day=2");
});
afterEach(() => vi.unstubAllEnvs());

describe("enabledOAuthProviders", () => {
  it("lists only the providers enabled by configuration, in a fixed order", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", " Apple, google ,facebook");
    expect(enabledOAuthProviders()).toEqual(["google", "apple"]);
  });

  it("is empty when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "");
    expect(enabledOAuthProviders()).toEqual([]);
  });
});

describe("startOAuthSignIn", () => {
  it("keeps a guest's anonymous id and sends them to the provider, back to the same page", async () => {
    auth.user = { id: "anon-1", is_anonymous: true };
    window.localStorage.setItem("plania_logged_out", "1");
    expect(await startOAuthSignIn("google", 1000)).toEqual({ error: null });
    expect(JSON.parse(window.localStorage.getItem(OAUTH_PENDING_KEY)!)).toEqual({ anonId: "anon-1", at: 1000 });
    expect(window.localStorage.getItem("plania_logged_out")).toBeNull();
    expect(auth.oauthCalls).toEqual([{ provider: "google", options: { redirectTo: "http://localhost:3000/trips/t1?day=2" } }]);
  });

  it("keeps nothing for a session that is not a guest's", async () => {
    auth.user = { id: "u-1", is_anonymous: false };
    window.localStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ anonId: "old", at: 1 }));
    await startOAuthSignIn("apple", 1000);
    expect(window.localStorage.getItem(OAUTH_PENDING_KEY)).toBeNull();
    expect(auth.oauthCalls).toHaveLength(1);
  });

  it("returns the provider's error and keeps nothing", async () => {
    auth.user = { id: "anon-1", is_anonymous: true };
    auth.oauthError = { message: "Unsupported provider: provider is not enabled" };
    expect(await startOAuthSignIn("apple", 1000)).toEqual({ error: "Unsupported provider: provider is not enabled" });
    expect(window.localStorage.getItem(OAUTH_PENDING_KEY)).toBeNull();
  });
});

describe("completePendingOAuthTransfer", () => {
  const pending = (anonId: string, at: number) => window.localStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ anonId, at }));

  it("moves the guest's trips to the account they came back with, once", async () => {
    pending("anon-1", 1000);
    expect(await completePendingOAuthTransfer("u-new", 2000)).toBe(true);
    expect(auth.rpcCalls).toEqual([["transfer_anonymous_data", { p_anon_id: "anon-1", p_new_id: "u-new" }]]);
    expect(window.localStorage.getItem(OAUTH_PENDING_KEY)).toBeNull();
    expect(await completePendingOAuthTransfer("u-new", 2000)).toBe(false);
    expect(auth.rpcCalls).toHaveLength(1);
  });

  it("does nothing without a pending sign-in, for the same id, or after 30 minutes", async () => {
    expect(await completePendingOAuthTransfer("u-new", 2000)).toBe(false);
    pending("u-new", 1000);
    expect(await completePendingOAuthTransfer("u-new", 2000)).toBe(false);
    pending("anon-1", 0);
    expect(await completePendingOAuthTransfer("u-new", 30 * 60 * 1000 + 1)).toBe(false);
    window.localStorage.setItem(OAUTH_PENDING_KEY, "not json");
    expect(await completePendingOAuthTransfer("u-new", 2000)).toBe(false);
    expect(auth.rpcCalls).toEqual([]);
    expect(window.localStorage.getItem(OAUTH_PENDING_KEY)).toBeNull();
  });

  it("reports a failed transfer", async () => {
    pending("anon-1", 1000);
    auth.rpcError = { message: "Unauthorized" };
    expect(await completePendingOAuthTransfer("u-new", 2000)).toBe(false);
  });
});
