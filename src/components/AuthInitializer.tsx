"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { claimPendingInvitations } from "@/lib/share/claim-client";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export function AuthInitializer() {
  const router = useRouter();
  const pathname = usePathname();

  const initialize = useAuthStore((s) => s.initialize);
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  const activeTrip = useItineraryStore((s) => s.activeTrip);
  const activeTripIsDraft = useItineraryStore((s) => s.activeTripIsDraft);
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
      // When offline, Supabase may temporarily report no session while our
      // own cache still holds valid auth+trip data.  Don't wipe state or
      // redirect — the user should keep viewing cached trips.
      if (isOffline()) return;

      clearData();
      if (pathname !== "/") router.push("/");
      return;
    }

    // If a draft (unsaved template) is active, don't overwrite it with
    // server data; the auto-save effect handles persistence on login.
    if (activeTripIsDraft) {
      return;
    }

    clearData();
    const isAnonymous = Boolean(user?.is_anonymous);
    void (async () => {
      // Invitations sent to this email become shared trips before the trips are loaded,
      // so an invitee with no trips of their own lands on the shared one.
      if (!isAnonymous && !isOffline()) await claimPendingInvitations();
      void fetchAllTrips();
      void fetchActiveTrip();
    })();
  }, [activeTripIsDraft, clearData, fetchActiveTrip, fetchAllTrips, initialized, pathname, router, user?.id, user?.is_anonymous]);

  useEffect(() => {
    if (activeTrip && pathname === "/") {
      router.push("/trips");
    }
  }, [activeTrip, pathname, router]);

  useEffect(() => {
    if (initialized && hasFetched && !loading && !activeTrip && pathname === "/trips") {
      // When offline, stay on /trips — the landing page is useless without
      // connectivity and the cache may still be hydrating the active trip.
      if (isOffline()) return;
      router.push("/");
    }
  }, [activeTrip, hasFetched, initialized, loading, pathname, router]);

  useEffect(() => {
    const handleFocus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const currentActiveTrip = useItineraryStore.getState().activeTrip;
      const activeTripId = currentActiveTrip?.id;

      if (navigator.onLine) {
        void fetchAllTrips();
        void fetchActiveTrip(activeTripId);
        void syncPendingMutations();
      } else if (!loading) {
        void fetchAllTrips();
        void fetchActiveTrip(activeTripId);
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
