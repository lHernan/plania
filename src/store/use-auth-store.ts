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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error) {
      set({ user: data.user, session: data.session });
    }
    set({ loading: false });
    return { error };
  },

  signUp: async (email, password) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (!error) {
      set({ user: data.user, session: data.session });
    }
    set({ loading: false });
    return { error };
  },

  signOut: async () => {
    set({ loading: true });
    const { error } = await supabase.auth.signOut();
    if (!error) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("plania_migration_done");
      }
      set({ user: null, session: null });
    }
    set({ loading: false });
    return { error };
  },

  initialize: async () => {
    if (typeof window === "undefined") return;

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    set({ 
      session, 
      user: session?.user ?? null, 
      loading: false, 
      initialized: true 
    });

    // Listen for auth changes
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ 
        session, 
        user: session?.user ?? null, 
        loading: false 
      });
    });
  },
}));
