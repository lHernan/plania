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
  const user = useAuthStore((s) => s.user);
  const { activeTrip, hasFetched, fetchAllTrips, fetchActiveTrip, clearData } = useItineraryStore();

  // Run auth initialization once on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Track the previous user id so we only react to actual user changes
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentId = user?.id ?? null;
    const prevId = prevUserIdRef.current;

    if (currentId === prevId) return;
    prevUserIdRef.current = currentId;

    if (!currentId) {
      clearData();
      if (pathname !== "/") router.push("/");
      return;
    }

    // New user — fetch their data fresh
    console.log("Plania: User changed →", currentId, "— fetching trips…");
    clearData();
    fetchAllTrips();
    fetchActiveTrip();
  }, [user?.id, clearData, fetchAllTrips, fetchActiveTrip, router, pathname]);

  // Once we have an active trip, redirect to /trips (unless already there)
  useEffect(() => {
    if (activeTrip && pathname === "/") {
      console.log("Plania: Active trip ready — navigating to /trips");
      router.push("/trips");
    }
  }, [activeTrip, pathname, router]);

  // If fetch is complete, there are no trips, and user is on /trips → send them to onboarding
  useEffect(() => {
    if (hasFetched && !activeTrip && pathname === "/trips") {
      console.log("Plania: No trips found — navigating to /");
      router.push("/");
    }
  }, [hasFetched, activeTrip, pathname, router]);

  // Revalidate on window focus
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
