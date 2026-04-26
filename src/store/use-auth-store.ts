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
  initialize: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
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
      // Re-create an anonymous session so user_id is always valid
      await supabase.auth.signInAnonymously();
    }
    set({ loading: false });
    return { error };
  },

  initialize: async () => {
    if (typeof window === "undefined") return;

    // Resolve existing session first — do NOT fetch data here.
    // AuthInitializer component coordinates the data fetch after this resolves.
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      console.log("Plania: No session — signing in anonymously…");
      await supabase.auth.signInAnonymously();
      // SIGNED_IN event will fire from onAuthStateChange, which AuthInitializer handles
    } else {
      set({ session, user: session.user, loading: false, initialized: true });
    }

    // Keep session state in sync — data coordination is handled by AuthInitializer
    supabase.auth.onAuthStateChange((_event, session) => {
      console.log("Plania: Auth state changed:", _event, session?.user?.id ?? "none");
      set({
        session,
        user: session?.user ?? null,
        loading: false,
        initialized: true,
      });
    });
  },
}));
