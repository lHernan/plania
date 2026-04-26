"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { Activity, ActivityState, TripDay, TripPlan, CriticalReservation, TripSummary } from "@/lib/types";

// HELPERS TO MAP DB SNAKE_CASE TO TS CAMELCASE
const mapActivityFromDb = (db: any): Activity => ({
  id: db.id,
  dayId: db.day_id,
  tripId: db.trip_id,
  userId: db.user_id,
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
  trip_id: a.tripId,
  user_id: a.userId,
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
  activeTrip: TripPlan | null;
  trips: TripSummary[];
  activeDayId: string;
  dayScrollY: Record<string, number>;
  loading: boolean;
  isImporting: boolean;
  isOptimizing: boolean;
  hasFetched: boolean;
  error: string | null;

  // Actions
  fetchAllTrips: () => Promise<void>;
  fetchActiveTrip: (tripId?: string, skipLoading?: boolean) => Promise<void>;
  createTrip: (name: string, startDate?: string, endDate?: string) => Promise<void>;
  deleteTrip: (tripId: string) => Promise<void>;
  switchTrip: (tripId: string) => Promise<void>;
  clearData: () => void;
  
  addTripDay: (date: string, city: string, label: string) => Promise<void>;
  removeTripDay: (dayId: string) => Promise<void>;
  updateTripDay: (dayId: string, updates: Partial<TripDay>) => Promise<void>;
  
  setActiveDay: (dayId: string) => void;
  setDayScroll: (dayId: string, y: number) => void;
  
  addActivity: (activity: Omit<Activity, "id" | "tripId" | "userId">) => Promise<void>;
  updateActivityState: (dayId: string, activityId: string, state: ActivityState) => Promise<void>;
  patchActivity: (dayId: string, activityId: string, patch: Partial<Activity>) => Promise<void>;
  removeActivity: (dayId: string, activityId: string) => Promise<void>;
  reorderActivities: (dayId: string, sourceId: string, targetId: string) => Promise<void>;
  
  toggleBooking: (bookingId: string) => Promise<void>;
  duplicateActivity: (dayId: string, activityId: string) => Promise<void>;
  addImportedActivities: (dayId: string, activities: Omit<Activity, "id" | "dayId" | "sort_order" | "tripId" | "userId">[]) => Promise<void>;
  
  addReservation: (reservation: Omit<CriticalReservation, "id" | "userId">) => Promise<void>;
  patchReservation: (reservationId: string, patch: Partial<CriticalReservation>) => Promise<void>;
  removeReservation: (reservationId: string) => Promise<void>;
  setIsImporting: (status: boolean) => void;
  optimizeDay: (dayId: string) => Promise<void>;
};

export const useItineraryStore = create<Store>((set, get) => ({
  activeTrip: null,
  trips: [],
  activeDayId: "",
  dayScrollY: {},
  loading: false,
  isImporting: false,
  isOptimizing: false,
  hasFetched: false,
  error: null,

  fetchAllTrips: async () => {
    try {
      // Supabase RLS scopes this automatically to the current auth.uid()
      const { data, error } = await supabase
        .from("trips")
        .select(`id, name, user_id, start_date, end_date, trip_days(count), activities(count)`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const summaries: TripSummary[] = (data || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        startDate: t.start_date,
        endDate: t.end_date,
        dayCount: t.trip_days[0].count,
        activityCount: t.activities[0].count,
      }));

      set({ trips: summaries });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  clearData: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("last_plania_trip_id");
    }
    set({ 
      activeTrip: null, 
      trips: [], 
      activeDayId: "", 
      hasFetched: false,
      loading: false,
      error: null 
    });
  },

  fetchActiveTrip: async (tripId, skipLoading = false) => {
    // Use the provided tripId or fall back to the most-recent trip from Supabase.
    // We deliberately do NOT read localStorage here — Supabase is the single source of truth.
    const targetId = tripId;
    console.log("Plania: Starting fetchActiveTrip…", targetId ?? "latest");
    if (!skipLoading) set({ loading: true, error: null, hasFetched: false });
    else set({ error: null });
    try {
      let query = supabase.from("trips").select("*");
      if (targetId) {
        query = query.eq("id", targetId);
      } else {
        query = query.order("created_at", { ascending: false }).limit(1);
      }

      let { data: trips, error: tripFetchError } = await query;
      
      if (tripFetchError) throw tripFetchError;

      let trip;
      if (!trips || trips.length === 0) {
        if (targetId) {
          console.log("Plania: Target trip not found, falling back to most recent...");
          if (typeof window !== "undefined") localStorage.removeItem("last_plania_trip_id");
          return get().fetchActiveTrip(); 
        }

        set({ activeTrip: null, loading: false, hasFetched: true });
        return;
      } else {
        trip = trips[0];
      }

      // Fetch Days, Activities, and Reservations for THIS trip
      const { data: days } = await supabase
        .from("trip_days")
        .select("*")
        .eq("trip_id", trip.id)
        .order("date", { ascending: true });

      const { data: activities } = await supabase
        .from("activities")
        .select("*")
        .eq("trip_id", trip.id) // Using the new flatter link!
        .order("sort_order", { ascending: true });

      const { data: reservations } = await supabase
        .from("critical_reservations")
        .select("*")
        .eq("trip_id", trip.id);

      const tripPlan: TripPlan = {
        id: trip.id,
        name: trip.name,
        userId: trip.user_id,
        startDate: trip.start_date,
        endDate: trip.end_date,
        createdAt: trip.created_at,
        days: (days || []).map(d => ({
          id: d.id,
          date: d.date,
          city: d.city,
          label: d.label,
          userId: d.user_id,
          activities: (activities || [])
            .filter(a => a.day_id === d.id)
            .map(mapActivityFromDb)
        })),
        criticalReservations: (reservations || []).map(r => ({
          id: r.id,
          title: r.title,
          userId: r.user_id,
          bookingDeadline: r.booking_deadline,
          reservationDate: r.reservation_date,
          bookingLink: r.booking_link,
          urgency: r.urgency,
          status: r.status,
          price: r.price
        }))
      };

      set({ 
        activeTrip: tripPlan, 
        activeDayId: tripPlan.days[0]?.id || "",
        loading: false,
        hasFetched: true
      });
      // No localStorage write — the trip ID is not persisted between sessions intentionally
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  createTrip: async (name, startDate, endDate) => {
    set({ loading: true });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const finalStartDate = startDate || new Date().toISOString().split('T')[0];
      
      const { data: newTrip, error } = await supabase
        .from("trips")
        .insert({ 
          name, 
          user_id: user?.id, 
          start_date: finalStartDate, 
          end_date: endDate || finalStartDate
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Calculate and seed all days in the range
      const daysToCreate = [];
      const start = new Date(finalStartDate + "T00:00:00");
      const end = new Date((endDate || finalStartDate) + "T00:00:00");
      
      // Limit to 90 days to avoid abuse/performance issues
      let dayCounter = 1;
      let current = new Date(start);
      while (current <= end && dayCounter <= 90) {
        daysToCreate.push({
          trip_id: newTrip.id,
          user_id: user?.id,
          date: current.toISOString().split('T')[0],
          city: "New Destination",
          label: `Day ${dayCounter++}`
        });
        current.setDate(current.getDate() + 1);
      }

      if (daysToCreate.length > 0) {
        await supabase.from("trip_days").insert(daysToCreate);
      }
      
      // Clear loading state and fetch the new trip
      // We don't set loading: true again inside fetchActiveTrip to prevent double animation
      await get().fetchActiveTrip(newTrip.id, true);
      
      set({ loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  deleteTrip: async (tripId) => {
    set({ loading: true, error: null });
    console.log("Plania: Attempting to delete trip:", tripId);
    try {
      // 1. Manually clear all child records in reverse order of dependency
      // Delete activities first as they depend on both trip and day
      const { error: err1 } = await supabase.from("activities").delete().eq("trip_id", tripId);
      if (err1) {
        console.error("Plania: Error deleting activities:", err1.message);
        throw err1;
      }

      // Delete reservations
      const { error: err2 } = await supabase.from("critical_reservations").delete().eq("trip_id", tripId);
      if (err2) {
        console.error("Plania: Error deleting reservations:", err2.message);
        throw err2;
      }

      // Delete days
      const { error: err3 } = await supabase.from("trip_days").delete().eq("trip_id", tripId);
      if (err3) {
        console.error("Plania: Error deleting days:", err3.message);
        throw err3;
      }
      
      // 2. Delete the trip itself
      const { data: deletedTrips, error: err4 } = await supabase
        .from("trips")
        .delete()
        .eq("id", tripId)
        .select();

      if (err4) {
        console.error("Plania: Trip delete failed:", err4.message);
        throw err4;
      }

      if (!deletedTrips || deletedTrips.length === 0) {
        console.error("Plania: No trip was deleted. This usually means Supabase RLS is blocking the operation.");
        console.warn("Plania: Recommendation: Check your Supabase 'trips' table policies. Ensure 'DELETE' is allowed for the user.");
        throw new Error("Permission Denied: You don't have permission to delete this trip. (Supabase RLS)");
      }

      console.log("Plania: Trip deleted successfully from DB:", deletedTrips[0].name);

      // 3. Refresh list
      await get().fetchAllTrips();
      const { trips } = get();
      
      if (trips.length > 0) {
        // If we deleted the active trip, switch to another one
        if (get().activeTrip?.id === tripId) {
          await get().fetchActiveTrip(trips[0].id);
        }
      } else {
        // No trips left, create a default one or set null
        set({ activeTrip: null });
      }
      set({ loading: false });
    } catch (e: any) {
      console.error("Plania: CRITICAL Delete Trip Error:", e);
      set({ error: e.message, loading: false });
    }
  },

  switchTrip: async (tripId) => {
    // skipLoading=true prevents resetting hasFetched, which would re-trigger the mount effect
    await get().fetchActiveTrip(tripId, true);
  },

  addTripDay: async (date, city, label) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const { data: newDay, error } = await supabase
      .from("trip_days")
      .insert({
        trip_id: activeTrip.id,
        user_id: activeTrip.userId,
        date,
        city,
        label
      })
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return;
    }

    // Refresh everything to keep it simple and consistent
    await get().fetchActiveTrip(activeTrip.id);
  },

  removeTripDay: async (dayId) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    try {
      // 1. Delete activities for this day first
      const { error: actError } = await supabase.from("activities").delete().eq("day_id", dayId);
      if (actError) throw actError;

      // 2. Delete the day itself
      const { error: dayError } = await supabase
        .from("trip_days")
        .delete()
        .eq("id", dayId);
      if (dayError) throw dayError;

      await get().fetchActiveTrip(activeTrip.id);
    } catch (e: any) {
      console.error("Plania: Remove Day Error:", e);
      set({ error: e.message });
    }
  },

  updateTripDay: async (dayId, updates) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const dbPayload: any = {};
    if (updates.date) dbPayload.date = updates.date;
    if (updates.city) dbPayload.city = updates.city;
    if (updates.label) dbPayload.label = updates.label;

    const { error } = await supabase
      .from("trip_days")
      .update(dbPayload)
      .eq("id", dayId);

    if (error) {
      set({ error: error.message });
      return;
    }

    await get().fetchActiveTrip(activeTrip.id);
  },

  setActiveDay: (activeDayId) => set({ activeDayId }),
  setDayScroll: (dayId, y) =>
    set((state) => ({ dayScrollY: { ...state.dayScrollY, [dayId]: y } })),

  addActivity: async (activity: Omit<Activity, "id" | "tripId" | "userId">) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const { data: newActivity, error } = await supabase
      .from("activities")
      .insert({
        ...mapActivityToDb(activity),
        trip_id: activeTrip.id,
        user_id: activeTrip.userId
      })
      .select()
      .single();

    if (error) {
      set({ error: error.message });
      return;
    }

    // Update local state
    set(state => ({
      activeTrip: {
        ...state.activeTrip!,
        days: state.activeTrip!.days.map(d => 
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
      activeTrip: {
        ...state.activeTrip!,
        days: state.activeTrip!.days.map(d => 
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
      activeTrip: {
        ...state.activeTrip!,
        days: state.activeTrip!.days.map(d => 
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
      activeTrip: {
        ...state.activeTrip!,
        days: state.activeTrip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: d.activities.filter(a => a.id !== activityId) }
            : d
        )
      }
    }));
  },

  reorderActivities: async (dayId, sourceId, targetId) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const day = activeTrip.days.find(d => d.id === dayId);
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
    const previousTrip = activeTrip;
    set({
      activeTrip: {
        ...activeTrip,
        days: activeTrip.days.map(d => d.id === dayId ? { ...d, activities: oldActivities } : d)
      }
    });

    const { error } = await supabase.from("activities").upsert(updates);
    if (error) {
      set({ activeTrip: previousTrip, error: error.message });
    }
  },

  toggleBooking: async (bookingId) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const booking = activeTrip.criticalReservations.find(r => r.id === bookingId);
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
      activeTrip: {
        ...state.activeTrip!,
        criticalReservations: state.activeTrip!.criticalReservations.map(r => 
          r.id === bookingId ? { ...r, status: newStatus } : r
        )
      }
    }));
  },

  duplicateActivity: async (dayId, activityId) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const day = activeTrip.days.find(d => d.id === dayId);
    const original = day?.activities.find(a => a.id === activityId);
    if (!original) return;

    const { data: newActivity, error } = await supabase
      .from("activities")
      .insert({
        ...mapActivityToDb(original),
        trip_id: activeTrip.id,
        user_id: activeTrip.userId,
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
      activeTrip: {
        ...state.activeTrip!,
        days: state.activeTrip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: [...d.activities, mapActivityFromDb(newActivity)].sort((a,b) => a.time.localeCompare(b.time)) }
            : d
        )
      }
    }));
  },

  addImportedActivities: async (dayId, activities: Omit<Activity, "id" | "dayId" | "sort_order" | "tripId" | "userId">[]) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const dbActivities = activities.map(a => ({
      ...mapActivityToDb(a as any),
      trip_id: activeTrip.id,
      user_id: activeTrip.userId,
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
      activeTrip: {
        ...state.activeTrip!,
        days: state.activeTrip!.days.map(d => 
          d.id === dayId 
            ? { ...d, activities: [...d.activities, ...(newOnes || []).map(mapActivityFromDb)].sort((a,b) => a.time.localeCompare(b.time)) }
            : d
        )
      }
    }));
  },

  addReservation: async (reservation) => {
    const { activeTrip } = get();
    if (!activeTrip) return;

    const dbPayload = {
      trip_id: activeTrip.id,
      user_id: activeTrip.userId,
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
      userId: data.user_id,
      bookingDeadline: data.booking_deadline,
      reservationDate: data.reservation_date,
      bookingLink: data.booking_link,
      urgency: data.urgency,
      status: data.status,
      price: data.price,
    };

    set((state) => ({
      activeTrip: {
        ...state.activeTrip!,
        criticalReservations: [...state.activeTrip!.criticalReservations, newRes]
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
      activeTrip: {
        ...state.activeTrip!,
        criticalReservations: state.activeTrip!.criticalReservations.map((r) =>
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
      activeTrip: {
        ...state.activeTrip!,
        criticalReservations: state.activeTrip!.criticalReservations.filter((r) => r.id !== reservationId)
      }
    }));
  },
  setIsImporting: (status: boolean) => set({ isImporting: status }),

  optimizeDay: async (dayId) => {
    const { activeTrip } = get();
    if (!activeTrip) return;
    const day = activeTrip.days.find(d => d.id === dayId);
    if (!day) return;

    set({ isOptimizing: true, error: null });
    try {
      const res = await fetch("/api/optimize-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: day.date, activities: day.activities })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const optimizedActivities = data.optimizedActivities as Activity[];

      const oldIds = day.activities.map(a => a.id);
      if (oldIds.length) {
        await supabase.from("activities").delete().in("id", oldIds);
      }

      const dbActivities = optimizedActivities.map((a, idx) => {
        const dbA: any = {
          ...mapActivityToDb(a),
          trip_id: activeTrip.id,
          user_id: activeTrip.userId,
          day_id: dayId,
          sort_order: idx
        };
        // Let Supabase generate new IDs for all to avoid conflict after delete
        return dbA;
      });

      const { data: newDbActivities, error: insertError } = await supabase
        .from("activities")
        .insert(dbActivities)
        .select();

      if (insertError) throw insertError;

      set(state => ({
        activeTrip: {
          ...state.activeTrip!,
          days: state.activeTrip!.days.map(d => 
            d.id === dayId 
              ? { ...d, activities: (newDbActivities || []).map(mapActivityFromDb).sort((a,b) => a.time.localeCompare(b.time)) }
              : d
          )
        },
        isOptimizing: false
      }));

    } catch (e: any) {
      set({ error: e.message || "Failed to optimize day", isOptimizing: false });
    }
  }
}));
