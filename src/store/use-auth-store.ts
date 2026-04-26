"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { User, Session } from "@supabase/supabase-js";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<{ error: any }>;
  initialize: () => void;
};

export const useAuthStore = create<AuthState>((set) => {
  // ─── Register the listener ONCE at store-creation time ───────────────────
  // Zustand stores are module-level singletons, so this block runs exactly
  // once per page load — no listenerRegistered flag needed.
  if (typeof window !== "undefined") {
    supabase.auth.onAuthStateChange((event, session) => {
      console.log("Plania [auth]:", event, session?.user?.id ?? "none", session?.user?.is_anonymous);

      if (event === "INITIAL_SESSION") {
        if (!session) {
          // No persisted session — create a fresh anonymous one
          supabase.auth.signInAnonymously();
          // The SIGNED_IN event from signInAnonymously will call set() below
        } else {
          set({ session, user: session.user, loading: false, initialized: true });
        }
      } else {
        // SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, etc.
        set({
          session,
          user: session?.user ?? null,
          loading: false,
          initialized: true,
        });
      }
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  return {
    user: null,
    session: null,
    loading: true,
    initialized: false,

    // initialize() is now a no-op — kept for API compatibility with AuthInitializer
    initialize: () => {},

    signIn: async (email, password) => {
      set({ loading: true });
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      set({ loading: false });
      if (!error && data.user) set({ user: data.user, session: data.session });
      return { error };
    },

    signUp: async (email, password) => {
      set({ loading: true });
      const { data, error } = await supabase.auth.signUp({ email, password });
      set({ loading: false });
      if (!error && data.user) set({ user: data.user, session: data.session });
      return { error };
    },

    signOut: async () => {
      set({ loading: true });
      const { error } = await supabase.auth.signOut();
      if (!error) {
        set({ user: null, session: null });
        await supabase.auth.signInAnonymously();
      }
      set({ loading: false });
      return { error };
    },
  };
});
