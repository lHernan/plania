"use client";

import { create } from "zustand";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { loadOfflineAuthCache, saveOfflineAuthCache, clearAllOfflineData } from "@/lib/offline-state";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  initialize: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => {
  if (typeof window !== "undefined") {
    supabase.auth.onAuthStateChange((event, session) => {
      console.log("Plania [auth]:", event, session?.user?.id ?? "none", session?.user?.is_anonymous);

      if (event === "INITIAL_SESSION" && !session) {
        if (navigator.onLine) {
          void supabase.auth.signInAnonymously();
        } else {
          set({ session: null, user: null, loading: false, initialized: true });
        }
        return;
      }

      set({
        session,
        user: session?.user ?? null,
        loading: false,
        initialized: true,
      });

      void saveOfflineAuthCache({
        user: session?.user ?? null,
        session,
        cachedAt: Date.now(),
      }).catch(() => {});
    });
  }

  return {
    user: null,
    session: null,
    loading: true,
    initialized: false,

    initialize: async () => {
      if (typeof window === "undefined") return;

      // If the user explicitly logged out, never restore the cached session.
      let loggedOut = false;
      try { loggedOut = localStorage.getItem("plania_logged_out") === "1"; } catch {}
      if (loggedOut) {
        try { await clearAllOfflineData(); } catch {}
        try { localStorage.removeItem("plania_logged_out"); } catch {}
        return;
      }

      const cachedAuth = await loadOfflineAuthCache();
      if (!cachedAuth) return;

      // Verify the cached session is still valid (online). If not, discard it
      // so a stale session doesn't resurrect the previous user's trips.
      if (navigator.onLine && cachedAuth.session?.access_token) {
        try {
          const client = (await import("@/lib/supabase")).supabase;
          const { data, error } = await client.auth.getUser(cachedAuth.session.access_token);
          if (error || !data?.user) {
            await clearAllOfflineData();
            return;
          }
        } catch {
          // network hiccup: fall through and trust the cache
        }
      }

      // Discard stale/expired cached sessions so a logged-out user
      // doesn't keep seeing the previous account's trips.
      const expiresAt = cachedAuth.session?.expires_at;
      if (expiresAt && expiresAt * 1000 < Date.now()) {
        try { await clearAllOfflineData(); } catch {}
        return;
      }

      set({
        user: cachedAuth.user,
        session: cachedAuth.session,
        loading: false,
        initialized: true,
      });
    },

    signIn: async (email, password) => {
      set({ loading: true });
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      set({ loading: false });

      if (!error) {
        set({ user: data.user, session: data.session });
        try { localStorage.removeItem("plania_logged_out"); } catch {}
      }

      return { error };
    },

    signUp: async (email, password) => {
      set({ loading: true });
      const { data, error } = await supabase.auth.signUp({ email, password });
      set({ loading: false });

      if (!error) {
        set({ user: data.user, session: data.session });
        try { localStorage.removeItem("plania_logged_out"); } catch {}
      }

      return { error };
    },

    signOut: async () => {
      const currentUser = (get as () => AuthState)().user;
      const currentUserId = currentUser?.id ?? null;
      const isAnonymous = Boolean(currentUser?.is_anonymous);

      set({ loading: true });

      // Mark that the user explicitly logged out, so initialize() won't
      // restore a stale cached session on the next load.
      try { localStorage.setItem("plania_logged_out", "1"); } catch {}

      // If signing out of a guest session, discard its temporary trips so
      // they are not transferred to the next account on login.
      if (isAnonymous && currentUserId && navigator.onLine) {
        try {
          await supabase.from("activities").delete().eq("user_id", currentUserId);
          await supabase.from("critical_reservations").delete().eq("user_id", currentUserId);
          await supabase.from("trip_days").delete().eq("user_id", currentUserId);
          await supabase.from("trips").delete().eq("user_id", currentUserId);
        } catch {
          // non-fatal
        }
      }

      const { error } = await supabase.auth.signOut();

      if (!error) {
      // Wipe all offline data so the previous user's trips/auth don't leak.
      try {
        await clearAllOfflineData();
      } catch {
        // non-fatal
      }
        set({ user: null, session: null });
        if (navigator.onLine) {
          await supabase.auth.signInAnonymously();
          // Force a full reload so no stale in-memory state survives.
          if (typeof window !== "undefined") {
            window.location.href = "/";
          }
        } else {
          set({ loading: false, initialized: true });
        }
      }

      set({ loading: false });
      return { error };
    },

    resetPassword: async (email) => {
      set({ loading: true });
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
      });
      set({ loading: false });
      return { error };
    },
  };
});
