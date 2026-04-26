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
      set({ user: null, session: null });
      // Immediately sign in anonymously again to maintain a valid user_id
      await supabase.auth.signInAnonymously();
    }
    set({ loading: false });
    return { error };
  },

  initialize: async () => {
    if (typeof window === "undefined") return;

    // Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      console.log("Plania: No session found, signing in anonymously...");
      await supabase.auth.signInAnonymously();
    } else {
      set({ 
        session, 
        user: session.user, 
        loading: false, 
        initialized: true 
      });
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange((_event, session) => {
      console.log("Plania: Auth state changed:", _event, session?.user?.id);
      
      // Only clear data if signing out or session is lost
      if (_event === 'SIGNED_OUT' || !session) {
        const { useItineraryStore } = require("./use-itinerary-store");
        useItineraryStore.getState().clearData();
      }
      
      // Fetch data immediately on sign in
      if (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION') {
        const { useItineraryStore } = require("./use-itinerary-store");
        const itStore = useItineraryStore.getState();
        itStore.fetchAllTrips();
        itStore.fetchActiveTrip();
      }

      set({ 
        session, 
        user: session?.user ?? null, 
        loading: false,
        initialized: true
      });
    });
  },
}));
