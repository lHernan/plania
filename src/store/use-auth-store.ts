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

// Track whether the auth listener has been registered globally (survives HMR)
let listenerRegistered = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  initialized: false,

  signIn: async (email, password) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false });
    if (!error && data.user) {
      set({ user: data.user, session: data.session });
    }
    return { error };
  },

  signUp: async (email, password) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signUp({ email, password });
    set({ loading: false });
    if (!error && data.user) {
      set({ user: data.user, session: data.session });
    }
    return { error };
  },

  signOut: async () => {
    set({ loading: true });
    const { error } = await supabase.auth.signOut();
    if (!error) {
      set({ user: null, session: null });
      // Re-create an anonymous session so user_id is always valid for RLS
      await supabase.auth.signInAnonymously();
    }
    set({ loading: false });
    return { error };
  },

  initialize: () => {
    if (typeof window === "undefined") return;

    // Register the auth listener exactly once per page load.
    // All session state (initial + changes) flows through this single listener.
    // This avoids the race condition caused by registering inside an async function.
    if (!listenerRegistered) {
      listenerRegistered = true;

      supabase.auth.onAuthStateChange((event, session) => {
        console.log("Plania: Auth event:", event, session?.user?.id ?? "none");

        if (event === "INITIAL_SESSION") {
          if (!session) {
            // No existing session — create anonymous one
            console.log("Plania: No session — signing in anonymously…");
            supabase.auth.signInAnonymously();
            // The SIGNED_IN event from signInAnonymously will set initialized
          } else {
            // Existing session found — set state and mark initialized
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
  },
}));
