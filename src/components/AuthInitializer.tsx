"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

export function AuthInitializer() {
  const router = useRouter();
  const pathname = usePathname();

  const initialize = useAuthStore((s) => s.initialize);
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  const activeTrip = useItineraryStore((s) => s.activeTrip);
  const hasFetched = useItineraryStore((s) => s.hasFetched);
  const loading = useItineraryStore((s) => s.loading);
  const fetchAllTrips = useItineraryStore((s) => s.fetchAllTrips);
  const fetchActiveTrip = useItineraryStore((s) => s.fetchActiveTrip);
  const clearData = useItineraryStore((s) => s.clearData);
  const syncPendingMutations = useItineraryStore((s) => s.syncPendingMutations);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!initialized) return;

    const currentUserId = user?.id ?? null;
    if (currentUserId === previousUserId.current) return;
    previousUserId.current = currentUserId;

    if (!currentUserId) {
      clearData();
      if (pathname !== "/") router.push("/");
      return;
    }

    clearData();
    void fetchAllTrips();
    void fetchActiveTrip();
  }, [clearData, fetchActiveTrip, fetchAllTrips, initialized, pathname, router, user?.id]);

  useEffect(() => {
    if (activeTrip && pathname === "/") {
      router.push("/trips");
    }
  }, [activeTrip, pathname, router]);

  useEffect(() => {
    if (initialized && hasFetched && !loading && !activeTrip && pathname === "/trips") {
      router.push("/");
    }
  }, [activeTrip, hasFetched, initialized, loading, pathname, router]);

  useEffect(() => {
    const handleFocus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      if (navigator.onLine) {
        void fetchAllTrips();
        void fetchActiveTrip();
        void syncPendingMutations();
      } else if (!loading) {
        void fetchAllTrips();
        void fetchActiveTrip();
      }
    };

    window.addEventListener("focus", handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void handleFocus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchActiveTrip, fetchAllTrips, loading, syncPendingMutations]);

  return null;
}
