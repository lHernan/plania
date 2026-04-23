"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { Activity, ActivityState, TripDay, TripPlan, CriticalReservation } from "@/lib/types";

// HELPERS TO MAP DB SNAKE_CASE TO TS CAMELCASE
const mapActivityFromDb = (db: any): Activity => ({
  id: db.id,
  dayId: db.day_id,
  city: db.city || "",
  title: db.title,
  time: db.time,
  durationMin: db.duration_min,
  notes: db.notes,
  location: db.location,
  mapsUrl: db.maps_url,
  reservationUrl: db.reservation_url,
  expectedCost: db.expected_cost,
  category: db.category,
  priority: db.priority,
  state: db.state,
  sort_order: db.sort_order,
});

const mapActivityToDb = (a: Partial<Activity>) => ({
  day_id: a.dayId,
  title: a.title,
  time: a.time,
  duration_min: a.durationMin,
  notes: a.notes,
  location: a.location,
  maps_url: a.mapsUrl,
  reservation_url: a.reservationUrl,
  expected_cost: a.expectedCost,
  category: a.category,
  priority: a.priority,
  state: a.state,
  sort_order: a.sort_order,
});

type Store = {
  trip: TripPlan | null;
  activeDayId: string;
  dayScrollY: Record<string, number>;
  loading: boolean;
  isImporting: boolean;
  error: string | null;

  // Actions
  fetchTrip: () => Promise<void>;
  setActiveDay: (dayId: string) => void;
  setDayScroll: (dayId: string, y: number) => void;
  
  addActivity: (activity: Omit<Activity, "id">) => Promise<void>;
  updateActivityState: (dayId: string, activityId: string, state: ActivityState) => Promise<void>;
  patchActivity: (dayId: string, activityId: string, patch: Partial<Activity>) => Promise<void>;
  removeActivity: (dayId: string, activityId: string) => Promise<void>;
  reorderActivities: (dayId: string, sourceId: string, targetId: string) => Promise<void>;
  
  toggleBooking: (bookingId: string) => Promise<void>;
  duplicateActivity: (dayId: string, activityId: string) => Promise<void>;
  addImportedActivities: (dayId: string, activities: Omit<Activity, "id" | "dayId" | "sort_order">[]) => Promise<void>;
  
  addReservation: (reservation: Omit<CriticalReservation, "id">) => Promise<void>;
  patchReservation: (reservationId: string, patch: Partial<CriticalReservation>) => Promise<void>;
  removeReservation: (reservationId: string) => Promise<void>;
  setIsImporting: (status: boolean) => void;
};

export const useItineraryStore = create<Store>((set, get) => ({
  trip: null,
  activeDayId: "",
  dayScrollY: {},
  loading: false,
  isImporting: false,
  error: null,

  fetchTrip: async () => {
    console.log("Plania: Starting fetchTrip...");
    set({ loading: true, error: null });
    try {
      // 1. Get the first trip available (Global Trip)
      let { data: trips, error: tripFetchError } = await supabase.from("trips").select("*").limit(1);
      
      if (tripFetchError) {
        console.error("Plania: Supabase Trip Fetch Error:", tripFetchError);
        throw tripFetchError;
      }

      let trip;
      if (!trips || trips.length === 0) {
        console.log("Plania: No trip found, seeding global trip...");
        // Create initial trip if none exists
        const { data: newTrip, error: createError } = await supabase
          .from("trips")
          .insert({ name: "My Seoul Adventure" })
          .select()
          .single();
        
        if (createError) throw createError;
        trip = newTrip;

        // Seed initial days (May 2-5)
        const daysToSeed = [
          { trip_id: trip.id, date: "2026-05-02", city: "Madrid", label: "Flight to Seoul" },
          { trip_id: trip.id, date: "2026-05-03", city: "Seoul", label: "Arrival & Hanok Magic" },
          { trip_id: trip.id, date: "2026-05-04", city: "Seoul", label: "Palace + Modern Seoul" },
          { trip_id: trip.id, date: "2026-05-05", city: "Seoul", label: "Foodie + Relax + Hongdae" },
        ];
        await supabase.from("trip_days").insert(daysToSeed);
        console.log("Plania: Seeding complete.");
      } else {
        trip = trips[0];
        console.log("Plania: Trip found:", trip.id);
      }

      // 2. Fetch Days
      const { data: days } = await supabase
        .from("trip_days")
        .select("*")
        .eq("trip_id", trip.id)
        .order("date", { ascending: true });

      // 3. Fetch Activities & Reservations
      const dayIds = (days || []).map(d => d.id);
      const { data: activities } = await supabase
        .from("activities")
        .select("*")
        .in("day_id", dayIds)
        .order("sort_order", { ascending: true });

      const { data: reservations } = await supabase
        .from("critical_reservations")
        .select("*")
        .eq("trip_id", trip.id);

      // 4. Assemble TripPlan object
      const tripPlan: TripPlan = {
        id: trip.id,
        name: trip.name,
        days: (days || []).map(d => ({
          id: d.id,
          date: d.date,
          city: d.city,
          label: d.label,
          activities: (activities || [])
            .filter(a => a.day_id === d.id)
            .map(mapActivityFromDb)
        })),
        criticalReservations: (reservations || []).map(r => ({
          id: r.id,
          title: r.title,
          bookingDeadline: r.booking_deadline,
          reservationDate: r.reservation_date,
          bookingLink: r.booking_link,
          urgency: r.urgency,
          status: r.status,
          price: r.price
        }))
      };

      set({ 
        trip: tripPlan, 
        activeDayId: tripPlan.days[0]?.id || "",
        loading: false 
      });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  setActiveDay: (activeDayId) => set({ activeDayId }),
  setDayScroll: (dayId, y) =>
    set((state) => ({ dayScrollY: { ...state.dayScrollY, [dayId]: y } })),

  addActivity: async (activity) => {
    const { trip } = get();
    if (!trip) return;

    const { data: newActivity, error } = await supabase
      .from("activities")
      .insert(mapActivityToDb(activity))
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return;
    }

    // Update local state
    set(state => ({
      trip: {
        ...state.trip!,
        days: state.trip!.days.map(d => 
          d.id === activity.dayId 
            ? { ...d, activities: [...d.activities, mapActivityFromDb(newActivity)].sort((a,b) => a.time.localeCompare(b.time)) }
            : d
        )
      }
    }));
  },

  updateActivityState: async (dayId, activityId, newState) => {
    const { error } = await supabase
      .from("activities")
      .update({ state: newState })
      .eq("id", activityId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set(state => ({
      trip: {
        ...state.trip!,
        days: state.trip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: d.activities.map(a => a.id === activityId ? { ...a, state: newState } : a) }
            : d
        )
      }
    }));
  },

  patchActivity: async (dayId, activityId, patch) => {
    const { error } = await supabase
      .from("activities")
      .update(mapActivityToDb(patch))
      .eq("id", activityId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set(state => ({
      trip: {
        ...state.trip!,
        days: state.trip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: d.activities.map(a => a.id === activityId ? { ...a, ...patch } : a) }
            : d
        )
      }
    }));
  },

  removeActivity: async (dayId, activityId) => {
    console.log("Plania Store: removeActivity called", { dayId, activityId });
    const { error } = await supabase
      .from("activities")
      .delete()
      .eq("id", activityId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set(state => ({
      trip: {
        ...state.trip!,
        days: state.trip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: d.activities.filter(a => a.id !== activityId) }
            : d
        )
      }
    }));
  },

  reorderActivities: async (dayId, sourceId, targetId) => {
    const { trip } = get();
    if (!trip) return;

    const day = trip.days.find(d => d.id === dayId);
    if (!day) return;

    const oldActivities = [...day.activities];
    const sourceIndex = oldActivities.findIndex(a => a.id === sourceId);
    const targetIndex = oldActivities.findIndex(a => a.id === targetId);
    
    if (sourceIndex === -1 || targetIndex === -1) return;

    const [moved] = oldActivities.splice(sourceIndex, 1);
    oldActivities.splice(targetIndex, 0, moved);

    // Update all sort_order in DB
    const updates = oldActivities.map((a, index) => ({
      id: a.id,
      sort_order: index
    }));

    // Optimistic update
    const previousTrip = trip;
    set({
      trip: {
        ...trip,
        days: trip.days.map(d => d.id === dayId ? { ...d, activities: oldActivities } : d)
      }
    });

    const { error } = await supabase.from("activities").upsert(updates);
    if (error) {
      set({ trip: previousTrip, error: error.message });
    }
  },

  toggleBooking: async (bookingId) => {
    const { trip } = get();
    if (!trip) return;

    const booking = trip.criticalReservations.find(r => r.id === bookingId);
    if (!booking) return;

    const newStatus = booking.status === "booked" ? "pending" : "booked";
    const { error } = await supabase
      .from("critical_reservations")
      .update({ status: newStatus })
      .eq("id", bookingId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set(state => ({
      trip: {
        ...state.trip!,
        criticalReservations: state.trip!.criticalReservations.map(r => 
          r.id === bookingId ? { ...r, status: newStatus } : r
        )
      }
    }));
  },

  duplicateActivity: async (dayId, activityId) => {
    const { trip } = get();
    if (!trip) return;

    const day = trip.days.find(d => d.id === dayId);
    const original = day?.activities.find(a => a.id === activityId);
    if (!original) return;

    const { data: newActivity, error } = await supabase
      .from("activities")
      .insert({
        ...mapActivityToDb(original),
        state: "pending",
        title: `${original.title} (Copy)`
      })
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return;
    }

    set(state => ({
      trip: {
        ...state.trip!,
        days: state.trip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: [...d.activities, mapActivityFromDb(newActivity)].sort((a,b) => a.time.localeCompare(b.time)) }
            : d
        )
      }
    }));
  },

  addImportedActivities: async (dayId, activities) => {
    const dbActivities = activities.map(a => ({
      ...mapActivityToDb(a as any),
      day_id: dayId,
      sort_order: 999 // Let them be at the end
    }));

    const { data: newOnes, error } = await supabase
      .from("activities")
      .insert(dbActivities)
      .select();

    if (error) {
      set({ error: error.message });
      return;
    }

    set(state => ({
      trip: {
        ...state.trip!,
        days: state.trip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: [...d.activities, ...(newOnes || []).map(mapActivityFromDb)].sort((a,b) => a.time.localeCompare(b.time)) }
            : d
        )
      }
    }));
  },

  addReservation: async (reservation) => {
    const { trip } = get();
    if (!trip) return;

    const dbPayload = {
      trip_id: trip.id,
      title: reservation.title,
      booking_deadline: reservation.bookingDeadline,
      reservation_date: reservation.reservationDate,
      booking_link: reservation.bookingLink,
      urgency: reservation.urgency,
      status: reservation.status,
      price: reservation.price,
    };

    const { data, error } = await supabase
      .from("critical_reservations")
      .insert(dbPayload)
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return;
    }

    const newRes: CriticalReservation = {
      id: data.id,
      title: data.title,
      bookingDeadline: data.booking_deadline,
      reservationDate: data.reservation_date,
      bookingLink: data.booking_link,
      urgency: data.urgency,
      status: data.status,
      price: data.price,
    };

    set((state) => ({
      trip: {
        ...state.trip!,
        criticalReservations: [...state.trip!.criticalReservations, newRes]
      }
    }));
  },

  patchReservation: async (reservationId, patch) => {
    const dbPayload: any = {};
    if (patch.title !== undefined) dbPayload.title = patch.title;
    if (patch.bookingDeadline !== undefined) dbPayload.booking_deadline = patch.bookingDeadline;
    if (patch.reservationDate !== undefined) dbPayload.reservation_date = patch.reservationDate;
    if (patch.bookingLink !== undefined) dbPayload.booking_link = patch.bookingLink;
    if (patch.urgency !== undefined) dbPayload.urgency = patch.urgency;
    if (patch.status !== undefined) dbPayload.status = patch.status;
    if (patch.price !== undefined) dbPayload.price = patch.price;

    const { error } = await supabase
      .from("critical_reservations")
      .update(dbPayload)
      .eq("id", reservationId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set((state) => ({
      trip: {
        ...state.trip!,
        criticalReservations: state.trip!.criticalReservations.map((r) =>
          r.id === reservationId ? { ...r, ...patch } : r
        )
      }
    }));
  },

  removeReservation: async (reservationId) => {
    const { error } = await supabase
      .from("critical_reservations")
      .delete()
      .eq("id", reservationId);

    if (error) {
      set({ error: error.message });
      return;
    }

    set((state) => ({
      trip: {
        ...state.trip!,
        criticalReservations: state.trip!.criticalReservations.filter((r) => r.id !== reservationId)
      }
    }));
  },
  setIsImporting: (status: boolean) => set({ isImporting: status })
}));
