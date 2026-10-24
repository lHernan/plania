import { useCallback, useRef } from "react";
import { useItineraryStore } from "@/store/use-itinerary-store";

export type CelebrationTier = 1 | 2 | 3;

export type CelebrationEvent = {
  tier: CelebrationTier;
  nextDayId?: string;
  activityTitle: string;
};

export function useCelebration() {
  const celebratingRef = useRef(false);

  const celebrate = useCallback(
    async (dayId: string, activityId: string): Promise<CelebrationEvent | null> => {
      if (celebratingRef.current) return null;

      const state = useItineraryStore.getState();
      const trip = state.activeTrip;
      if (!trip) return null;

      const day = trip.days.find((d) => d.id === dayId);
      if (!day) return null;

      const activity = day.activities.find((a) => a.id === activityId);
      if (!activity || activity.state === "completed") return null;

      // Count remaining BEFORE this completion
      const remainingInDay = day.activities.filter(
        (a) => a.id !== activityId && a.state !== "completed"
      ).length;

      const remainingInTrip = trip.days.reduce((sum, d) => {
        return (
          sum +
          d.activities.filter(
            (a) => a.id !== activityId && a.state !== "completed"
          ).length
        );
      }, 0);

      // Empty day (0 activities total) is never treated as complete
      if (day.activities.length === 0) return null;

      let tier: CelebrationTier;
      let nextDayId: string | undefined;

      if (remainingInDay === 0 && remainingInTrip === 0) {
        tier = 3;
      } else if (remainingInDay === 0) {
        tier = 2;
        const activeIndex = trip.days.findIndex((d) => d.id === dayId);
        const nextDay = trip.days[activeIndex + 1];
        if (nextDay) nextDayId = nextDay.id;
      } else {
        tier = 1;
      }

      celebratingRef.current = true;

      // Perform the store update
      await state.updateActivityState(dayId, activityId, "completed");

      // Reset guard after a short delay to allow animation
      setTimeout(() => {
        celebratingRef.current = false;
      }, tier === 1 ? 2000 : 5000);

      return { tier, nextDayId, activityTitle: activity.title };
    },
    []
  );

  return { celebrate };
}
