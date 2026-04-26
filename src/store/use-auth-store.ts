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

// Helper to get the itinerary store at call-time (avoids circular import at module load)
function getItineraryStore() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("./use-itinerary-store").useItineraryStore.getState();
}

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
      // Auth listener will handle the fetch — no double-fetch here
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
      // Clear all trip state immediately
      getItineraryStore().clearData();
      set({ user: null, session: null });
      // Create a fresh anonymous session so the app always has a valid user_id
      await supabase.auth.signInAnonymously();
    }
    set({ loading: false });
    return { error };
  },

  initialize: async () => {
    if (typeof window === "undefined") return;

    // ── STEP 1: Resolve session before any data fetch ──────────────────────
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      console.log("Plania: No session — signing in anonymously…");
      await supabase.auth.signInAnonymously();
      // The SIGNED_IN event from the listener below will trigger the data fetch
    } else {
      set({ session, user: session.user, loading: false, initialized: true });
      // Trigger initial data load now that we have a confirmed user
      const itStore = getItineraryStore();
      await itStore.fetchAllTrips();
      await itStore.fetchActiveTrip();
    }

    // ── STEP 2: React to future auth changes ───────────────────────────────
    supabase.auth.onAuthStateChange((_event, session) => {
      console.log("Plania: Auth state changed:", _event, session?.user?.id ?? "none");

      if (_event === "SIGNED_OUT" || !session) {
        // clearData is already called in signOut() — this handles unexpected session loss
        getItineraryStore().clearData();
      }

      if (_event === "SIGNED_IN") {
        // Only re-fetch on an actual new sign-in, not on INITIAL_SESSION
        // (INITIAL_SESSION is handled synchronously above to avoid double-fetch)
        const itStore = getItineraryStore();
        itStore.clearData();
        itStore.fetchAllTrips();
        itStore.fetchActiveTrip();
      }

      set({
        session,
        user: session?.user ?? null,
        loading: false,
        initialized: true,
      });
    });

    // ── STEP 3: Revalidate when user returns to the tab ────────────────────
    window.addEventListener("focus", () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        const itStore = getItineraryStore();
        itStore.fetchAllTrips();
        itStore.fetchActiveTrip();
      });
    });
  },
}));
