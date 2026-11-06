"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { completePendingOAuthTransfer, peekPendingOAuthDraft } from "@/lib/auth/oauth";
import { claimPendingInvitations } from "@/lib/share/claim-client";
import { parseTripPath, tripPath } from "@/lib/trip-routes";
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
  const hasTrips = useItineraryStore((s) => s.trips.length > 0);
  const hasFetched = useItineraryStore((s) => s.hasFetched);
  const loading = useItineraryStore((s) => s.loading);
  const fetchAllTrips = useItineraryStore((s) => s.fetchAllTrips);
  const fetchActiveTrip = useItineraryStore((s) => s.fetchActiveTrip);
  const clearData = useItineraryStore((s) => s.clearData);
  const syncPendingMutations = useItineraryStore((s) => s.syncPendingMutations);
  const loadTemplate = useItineraryStore((s) => s.loadTemplate);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const previousUserId = useRef<string | null>(null);
  // The landing opens the selected trip only on arrival (app entry or a sign-in); once the
  // user has left it, coming back to "/" is a choice and the landing stays.
  const landingOpensTrip = useRef(true);
  /** The trip that was open when the user came back to the landing. */
  const tripOnLanding = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!initialized) return;

    const currentUserId = user?.id ?? null;
    if (currentUserId === previousUserId.current) return;
    previousUserId.current = currentUserId;
    landingOpensTrip.current = true;

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
    // Back from Google or Apple with an unsaved draft: it is active again right away, before any
    // wait, so nothing loads or routes over it; TripView's auto-save then stores it.
    const returnedDraft = !isAnonymous && !isOffline() ? peekPendingOAuthDraft() : null;
    if (returnedDraft) loadTemplate(returnedDraft);
    void (async () => {
      // Invitations sent to this email become shared trips before the trips are loaded,
      // so an invitee with no trips of their own lands on the shared one.
      if (!isAnonymous && !isOffline()) {
        // Back from Google or Apple: the guest's trips move to the account before anything loads.
        await completePendingOAuthTransfer(currentUserId);
        await claimPendingInvitations();
      }
      if (returnedDraft) {
        void fetchAllTrips();
        return;
      }
      void fetchAllTrips();
      // A trip URL opens that trip; anywhere else the selection picks one.
      const urlTripId = parseTripPath(pathname)?.tripId;
      void (urlTripId ? fetchActiveTrip(urlTripId) : fetchActiveTrip());
    })();
  }, [activeTripIsDraft, clearData, fetchActiveTrip, fetchAllTrips, initialized, loadTemplate, pathname, router, user?.id, user?.is_anonymous]);

  // The landing opens the selected trip; /trips is the trip list and stays put.
  useEffect(() => {
    if (pathname !== "/") {
      landingOpensTrip.current = false;
      tripOnLanding.current = undefined;
      return;
    }
    const tripId = activeTrip?.id ?? null;
    if (tripOnLanding.current === undefined) tripOnLanding.current = tripId;
    // A trip created or picked on the landing (template, quick start) still opens.
    if (tripId && (landingOpensTrip.current || tripId !== tripOnLanding.current)) {
      landingOpensTrip.current = false;
      router.push(tripPath(tripId));
    }
  }, [activeTrip, pathname, router]);

  const isRegistered = Boolean(user && !user.is_anonymous);

  useEffect(() => {
    if (!initialized || !hasFetched || loading || activeTrip) return;
    // When offline, stay put — the landing page is useless without
    // connectivity and the cache may still be hydrating the active trip.
    if (isOffline()) return;
    const onTripPage = pathname.startsWith("/trips/");
    if (isRegistered) {
      // With no trips at all, a registered user gets the empty trip list (create, templates)
      // instead of the landing. While trips exist the selected one is still on its way.
      if (!hasTrips && ((pathname === "/" && landingOpensTrip.current) || onTripPage)) router.push("/trips");
      else if (hasTrips && onTripPage) router.push("/");
      return;
    }
    if (pathname === "/trips" || onTripPage) router.push("/");
  }, [activeTrip, hasFetched, hasTrips, initialized, isRegistered, loading, pathname, router]);

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
