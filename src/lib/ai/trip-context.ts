import type { Activity, CriticalReservation, ShoppingItem, TripDay, TravelContext } from "@/lib/types";

export type TripContextInput = {
  trip: {
    id: string;
    name: string;
    startDate?: string | null;
    endDate?: string | null;
    ownerId: string;
    travelContext?: TravelContext | null;
  };
  days: Array<Pick<TripDay, "id" | "date" | "city" | "label"> & { activities: Activity[] }>;
  reservations: CriticalReservation[];
  shoppingItems?: ShoppingItem[];
  currentDate: string;
  currentTime: string;
  currentTimeZone?: string;
  currentTimeZoneSource?: "trip_context" | "utc_fallback";
};

export type TripContext = TripContextInput;

export function buildTripContext(input: TripContextInput) {
  const canShareTravelContext = input.trip.travelContext?.shareWithAI === true;
  // Planned by number of days: the day dates are placeholders, so the agent gets day numbers.
  const undated = input.trip.travelContext?.undated === true;

  return {
    trip: {
      id: input.trip.id,
      name: input.trip.name,
      startDate: undated ? null : input.trip.startDate,
      endDate: undated ? null : input.trip.endDate,
      ...(undated ? { undated: true as const } : {}),
    },
    travelContext: canShareTravelContext ? input.trip.travelContext : null,
    current: {
      date: input.currentDate,
      time: input.currentTime,
      timeZone: canShareTravelContext ? input.currentTimeZone ?? null : "UTC",
      timeZoneSource: canShareTravelContext ? input.currentTimeZoneSource ?? "unknown" : "utc_fallback",
    },
    days: input.days.map((day, index) => ({
      id: day.id,
      date: undated ? null : day.date,
      ...(undated ? { dayNumber: index + 1 } : {}),
      city: day.city,
      label: day.label,
      activities: day.activities.map((activity) => ({
        id: activity.id,
        title: activity.title,
        time: activity.time,
        durationMin: activity.durationMin,
        category: activity.category,
        priority: activity.priority,
        state: activity.state,
        location: activity.location ?? null,
        notes: activity.notes ?? null,
        expectedCost: activity.expectedCost ?? null,
      })),
    })),
    reservations: input.reservations.map((reservation) => ({
      id: reservation.id,
      title: reservation.title,
      bookingDeadline: reservation.bookingDeadline,
      reservationDate: reservation.reservationDate,
      status: reservation.status,
      urgency: reservation.urgency,
      price: reservation.price ?? null,
    })),
    shoppingItems: (input.shoppingItems ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      priority: item.priority,
      status: item.status,
    })),
  };
}
