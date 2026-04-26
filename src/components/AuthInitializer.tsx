"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { supabase } from "@/lib/supabase";

/**
 * AuthInitializer — renders null, runs once at app root.
 *
 * Responsibilities:
 * 1. Call auth.initialize() to resolve/create the Supabase session.
 * 2. Watch for user changes and load trip data accordingly.
 * 3. Clear trip data on sign-out.
 * 4. Revalidate trip data when the browser tab regains focus.
 *
 * Keeping this coordination here (not inside either store) prevents
 * circular module dependencies and HMR issues.
 */
export function AuthInitializer() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const { fetchAllTrips, fetchActiveTrip, clearData } = useItineraryStore();

  // Run auth initialization once on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Track the previous user id so we can detect actual user changes
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentId = user?.id ?? null;
    const prevId = prevUserIdRef.current;

    if (currentId === prevId) return; // no change, skip
    prevUserIdRef.current = currentId;

    if (!currentId) {
      // Signed out — clear everything
      clearData();
      return;
    }

    // New user (sign-in or anonymous init) — load their data fresh
    console.log("Plania: User changed →", currentId, "— fetching trips…");
    clearData();
    fetchAllTrips();
    fetchActiveTrip();
  }, [user?.id, clearData, fetchAllTrips, fetchActiveTrip]);

  // Revalidate on window focus (handles tab switching, device wake, etc.)
  useEffect(() => {
    const handleFocus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      console.log("Plania: Window focused — revalidating trips…");
      fetchAllTrips();
      fetchActiveTrip();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchAllTrips, fetchActiveTrip]);

  return null;
}
