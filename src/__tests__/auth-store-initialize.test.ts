// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Coming back from Google or Apple, supabase-js reports the new session from the URL while
// initialize() is still reading the cached session: the cache must never replace it.
const state = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  cached: null as unknown,
  releaseCache: null as null | (() => void),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        state.listener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getUser: async () => ({ data: { user: { id: "anon-1" } }, error: null }),
      signInAnonymously: vi.fn(async () => ({})),
    },
  },
}));
vi.mock("@/lib/offline-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-state")>()),
  saveOfflineAuthCache: vi.fn(async () => {}),
  loadOfflineAuthCache: vi.fn(
    () =>
      new Promise((resolve) => {
        state.releaseCache = () => resolve(state.cached);
      }),
  ),
}));

const { useAuthStore } = await import("@/store/use-auth-store");

const guest = { id: "anon-1", is_anonymous: true };
const account = { id: "u-new", is_anonymous: false };
const session = (user: unknown) => ({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + 3600, user });

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ user: null, session: null, loading: true, initialized: false });
  state.cached = { user: guest, session: session(guest), cachedAt: Date.now() };
  state.releaseCache = null;
});

describe("useAuthStore.initialize", () => {
  it("never replaces a session supabase already reported with the cached one", async () => {
    const pending = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(state.releaseCache).toBeTruthy());
    state.listener!("SIGNED_IN", session(account));
    state.releaseCache!();
    await pending;
    expect(useAuthStore.getState().user).toMatchObject({ id: "u-new" });
  });

  it("offline, still restores the cached session after supabase reported no session", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const pending = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(state.releaseCache).toBeTruthy());
    state.listener!("INITIAL_SESSION", null);
    expect(useAuthStore.getState()).toMatchObject({ initialized: true, user: null });
    state.releaseCache!();
    await pending;
    expect(useAuthStore.getState().user).toMatchObject({ id: "anon-1" });
  });

  it("still restores the cached session when nothing was reported yet", async () => {
    state.releaseCache = null;
    const pending = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(state.releaseCache).toBeTruthy());
    state.releaseCache!();
    await pending;
    expect(useAuthStore.getState().user).toMatchObject({ id: "anon-1" });
    expect(useAuthStore.getState().initialized).toBe(true);
  });
});
