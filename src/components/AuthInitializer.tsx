"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { supabase } from "@/lib/supabase";

/**
 * AuthInitializer — renders null, runs once at app root.
 *
 * Responsibilities:
 * 1. Call auth.initialize() to resolve/create the Supabase session.
 * 2. Watch for user changes and load trip data accordingly.
 * 3. Redirect to /trips once an active trip is available.
 * 4. Clear trip data on sign-out and redirect to /.
 * 5. Revalidate trip data when the browser tab regains focus.
 */
export function AuthInitializer() {
  const router = useRouter();
  const pathname = usePathname();

  const initialize = useAuthStore((s) => s.initialize);
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  const {
    activeTrip,
    hasFetched,
    loading,
    fetchAllTrips,
    fetchActiveTrip,
    clearData,
  } = useItineraryStore();

  // Run auth initialization once on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Track the previous user id so we only react to actual user changes
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Don't act until auth is fully resolved (prevents firing on the null→null no-op)
    if (!initialized) return;

    const currentId = user?.id ?? null;
    const prevId = prevUserIdRef.current;

    if (currentId === prevId) return;
    prevUserIdRef.current = currentId;

    if (!currentId) {
      clearData();
      if (pathname !== "/") router.push("/");
      return;
    }

    // New user confirmed — fetch their data fresh
    console.log("Plania [init]: User confirmed →", currentId, "anon:", user?.is_anonymous);
    clearData();
    fetchAllTrips();
    fetchActiveTrip();
  }, [initialized, user?.id, clearData, fetchAllTrips, fetchActiveTrip, router, pathname]);

  // Once we have an active trip, redirect to /trips (unless already there)
  useEffect(() => {
    if (activeTrip && pathname === "/") {
      console.log("Plania: Active trip ready — navigating to /trips");
      router.push("/trips");
    }
  }, [activeTrip, pathname, router]);

  // Guard: only redirect from /trips → / when:
  // - fetch is fully complete (hasFetched=true)
  // - not currently loading (avoids premature redirect on slow mobile networks)
  // - there's genuinely no active trip
  // - auth is initialized (avoids redirect before session is resolved)
  useEffect(() => {
    if (initialized && hasFetched && !loading && !activeTrip && pathname === "/trips") {
      console.log("Plania: No trips found after full fetch — navigating to /");
      router.push("/");
    }
  }, [initialized, hasFetched, loading, activeTrip, pathname, router]);

  // Revalidate on window focus (handles returning from background on mobile)
  useEffect(() => {
    const handleFocus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      console.log("Plania: Window focused — revalidating trips…");
      // Only refetch if not already loading
      if (!loading) {
        fetchAllTrips();
        fetchActiveTrip();
      }
    };

    window.addEventListener("focus", handleFocus);
    // Mobile: visibilitychange fires when user switches back to the tab/app
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchAllTrips, fetchActiveTrip, loading]);

  return null;
}
