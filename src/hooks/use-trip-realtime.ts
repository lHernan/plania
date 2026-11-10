"use client";

import { useEffect } from "react";
import { refreshTripExpenses } from "@/hooks/use-trip-expenses";
import { supabase } from "@/lib/supabase";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { useOfflineStore } from "@/store/use-offline-store";

/** Changes arrive in bursts (an expense and its splits, a replaced assignment): one reload each. */
export const TRIP_REALTIME_DEBOUNCE_MS = 300;

type ChangeConfig = { event: "*" | "DELETE"; schema: "public"; table: string; filter?: string };
type RealtimeChannel = {
  on: (type: "postgres_changes", config: ChangeConfig, handler: () => void) => RealtimeChannel;
  subscribe: () => RealtimeChannel;
};
type RealtimeClient = {
  channel?: (name: string) => RealtimeChannel;
  removeChannel?: (channel: RealtimeChannel) => unknown;
};

function debounced(run: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, TRIP_REALTIME_DEBOUNCE_MS);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Keeps the open trip in step with the other members: expenses, splits and settlements
 * reload the shared expenses, and assignment changes reload who each activity is for.
 * Off for drafts, offline, and where the client has no realtime.
 */
export function useTripRealtime(tripId: string, enabled: boolean) {
  const isOnline = useOfflineStore((state) => state.isOnline);

  useEffect(() => {
    if (!tripId || !enabled || !isOnline) return;
    const client = supabase as unknown as RealtimeClient;
    if (typeof client.channel !== "function") return;

    const expenses = debounced(() => refreshTripExpenses(tripId));
    const participants = debounced(() => void useItineraryStore.getState().refreshActivityParticipants(tripId));
    const byTrip = `trip_id=eq.${tripId}`;
    const channel = client
      .channel(`trip-sync:${tripId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: byTrip }, expenses.schedule)
      // No trip_id column: row level security limits the rows each member receives.
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_splits" }, expenses.schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_settlements", filter: byTrip }, expenses.schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_participants", filter: byTrip }, participants.schedule)
      // Supabase never delivers DELETE events to a filtered subscription, so deletes come unfiltered.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "expense_settlements" }, expenses.schedule)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "activity_participants" }, participants.schedule);
    channel.subscribe();

    return () => {
      expenses.cancel();
      participants.cancel();
      void client.removeChannel?.(channel);
    };
  }, [tripId, enabled, isOnline]);
}
