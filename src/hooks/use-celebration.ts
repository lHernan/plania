import { useCallback, useRef } from "react";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { computeCompletionCelebration, type CelebrationTier } from "@/lib/trip-progress";

export type { CelebrationTier };

export type CelebrationEvent = {
  id: number;
  tier: CelebrationTier;
  nextDayId?: string;
  activityTitle: string;
  /**
   * Tier-1 toasts for things other than activities: a shopping item bought, a reservation
   * booked, the app tour finished.
   */
  kind?: "shopping" | "reservation" | "tour";
};

export type CompletionResult = {
  ok: boolean;
  event: CelebrationEvent | null;
};

/**
 * Completes an activity from an explicit user action and decides its celebration.
 * Celebrations only come from here — never from loading data or switching days.
 */
export function useCelebration() {
  const inFlightRef = useRef(new Set<string>());
  const eventIdRef = useRef(0);

  const complete = useCallback(async (dayId: string, activityId: string): Promise<CompletionResult> => {
    // Repeated taps on the same activity while its write is pending are ignored.
    if (inFlightRef.current.has(activityId)) return { ok: true, event: null };

    const state = useItineraryStore.getState();
    const trip = state.activeTrip;
    if (!trip) return { ok: false, event: null };

    // Computed BEFORE the store update; null when already completed.
    const outcome = computeCompletionCelebration(trip, dayId, activityId);
    if (!outcome) return { ok: true, event: null };

    const title =
      trip.days.find((d) => d.id === dayId)?.activities.find((a) => a.id === activityId)?.title ?? "";

    inFlightRef.current.add(activityId);
    try {
      const ok = await state.updateActivityState(dayId, activityId, "completed");
      if (!ok) return { ok: false, event: null };
      eventIdRef.current += 1;
      return { ok: true, event: { id: eventIdRef.current, ...outcome, activityTitle: title } };
    } finally {
      inFlightRef.current.delete(activityId);
    }
  }, []);

  return { complete };
}
