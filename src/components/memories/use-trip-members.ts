"use client";

import { useEffect, useState } from "react";
import type { MemoryError } from "@/lib/memories-sync";
import type { TripMember } from "@/lib/types";
import { useItineraryStore } from "@/store/use-itinerary-store";

type MembersResult = { members: TripMember[]; error?: MemoryError };

// One request per trip shared by every memory list and editor on screen; failures are retried.
const cache = new Map<string, Promise<MembersResult>>();

export function clearTripMembersCache() {
  cache.clear();
}

function loadMembers(tripId: string): Promise<MembersResult> {
  const cached = cache.get(tripId);
  if (cached) return cached;
  const request = useItineraryStore
    .getState()
    .loadTripMembers(tripId)
    .catch((): MembersResult => ({ members: [], error: "failed" }))
    .then((result) => {
      if (result.error) cache.delete(tripId);
      return result;
    });
  cache.set(tripId, request);
  return request;
}

/** The people of the trip (owner first), loaded only while `enabled`. */
export function useTripMembers(tripId: string, enabled = true): { members: TripMember[]; loading: boolean; error?: MemoryError } {
  const [state, setState] = useState<{ tripId: string; result: MembersResult } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadMembers(tripId).then((result) => {
      if (!cancelled) setState({ tripId, result });
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, enabled]);

  const result = state?.tripId === tripId ? state.result : null;
  return { members: result?.members ?? [], loading: enabled && !result, error: result?.error };
}
