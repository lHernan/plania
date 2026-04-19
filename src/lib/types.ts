export type ActivityCategory =
  | "sightseeing"
  | "reservation"
  | "transport"
  | "hotel"
  | "food"
  | "shopping"
  | "photos"
  | "nightlife"
  | "other";

export type ActivityState = "pending" | "completed" | "skipped" | "delayed";
export type Priority = "low" | "medium" | "high" | "critical";
export type ReservationStatus = "pending" | "booked";

export type Activity = {
  id: string;
  dayId: string;
  city: string;
  title: string;
  time: string;
  durationMin: number;
  notes?: string;
  location?: string;
  mapsUrl?: string;
  reservationUrl?: string;
  transportNotes?: string;
  expectedCost?: number;
  category: ActivityCategory;
  priority: Priority;
  state: ActivityState;
  sort_order: number;
};

export type BookingUrgency = "safe" | "this_week" | "today";

export type CriticalReservation = {
  id: string;
  title: string;
  bookingDeadline: string;
  reservationDate: string;
  bookingLink?: string;
  urgency: BookingUrgency;
  status: ReservationStatus;
  price?: number;
  cancellationNotes?: string;
};

export type TripDay = {
  id: string;
  date: string;
  city: string;
  label: string;
  activities: Activity[];
};

export type TripPlan = {
  id: string;
  name: string;
  days: TripDay[];
  criticalReservations: CriticalReservation[];
};

export type OptimizationSuggestion = {
  id: string;
  title: string;
  reason: string;
  impact: "time" | "cost" | "comfort";
};
