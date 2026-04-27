"use client";

import { create } from "zustand";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { loadOfflineAuthCache, saveOfflineAuthCache } from "@/lib/offline-state";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  initialize: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => {
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
      });
    });
  }

  return {
    user: null,
    session: null,
    loading: true,
    initialized: false,

    initialize: async () => {
      if (typeof window === "undefined") return;

      const cachedAuth = await loadOfflineAuthCache();
      if (!cachedAuth) return;

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
      }

      return { error };
    },

    signUp: async (email, password) => {
      set({ loading: true });
      const { data, error } = await supabase.auth.signUp({ email, password });
      set({ loading: false });

      if (!error) {
        set({ user: data.user, session: data.session });
      }

      return { error };
    },

    signOut: async () => {
      set({ loading: true });
      const { error } = await supabase.auth.signOut();

      if (!error) {
        set({ user: null, session: null });
        if (navigator.onLine) {
          await supabase.auth.signInAnonymously();
        } else {
          set({ loading: false, initialized: true });
        }
      }

      set({ loading: false });
      return { error };
    },
  };
});
