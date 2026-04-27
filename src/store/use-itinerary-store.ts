"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { removeCachedDocument } from "@/lib/offline-documents";
import {
  createOfflineId,
  deleteOfflineMutation,
  enqueueOfflineMutation,
  getRetryDelayMs,
  isOfflineId,
  listOfflineMutations,
  loadOfflineTripCache,
  saveOfflineTripCache,
  type OfflineMutationQueueEntry,
} from "@/lib/offline-state";
import type {
  Activity,
  ActivityFile,
  ActivityState,
  CriticalReservation,
  FocusArea,
  ShoppingItem,
  TripDay,
  TripPlan,
  TripSummary,
} from "@/lib/types";
import { useAuthStore } from "@/store/use-auth-store";
import { useOfflineStore } from "@/store/use-offline-store";

type ActivityFileDb = {
  id: string;
  activity_id: string;
  trip_id: string;
  user_id: string;
  file_url: string;
  file_path: string;
  file_type: "pdf" | "image" | "other";
  file_name: string;
  created_at: string;
  focus_area?: FocusArea | null;
};

type ActivityDb = {
  id: string;
  day_id: string;
  trip_id: string;
  user_id: string;
  city?: string | null;
  title: string;
  time: string;
  duration_min: number;
  notes?: string | null;
  location?: string | null;
  maps_url?: string | null;
  reservation_url?: string | null;
  expected_cost?: number | null;
  category: Activity["category"];
  priority: Activity["priority"];
  state: ActivityState;
  sort_order: number;
};

type TripDb = {
  id: string;
  name: string;
  user_id: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
};

type TripDayDb = {
  id: string;
  trip_id: string;
  user_id: string;
  date: string;
  city: string;
  label: string;
};

type ReservationDb = {
  id: string;
  trip_id: string;
  user_id: string;
  title: string;
  booking_deadline: string;
  reservation_date: string;
  booking_link?: string | null;
  urgency: CriticalReservation["urgency"];
  status: CriticalReservation["status"];
  price?: number | null;
};

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
  addShoppingItems: (items: ShoppingItem[]) => Promise<void>;
  toggleShoppingItemStatus: (itemId: string) => Promise<void>;
  updateShoppingItem: (itemId: string, patch: Partial<ShoppingItem>) => Promise<void>;
  removeShoppingItem: (itemId: string) => Promise<void>;
  ignoreShoppingSuggestion: (ignoreKey: string) => Promise<void>;
  uploadActivityFile: (activityId: string, file: File) => Promise<void>;
  deleteActivityFile: (fileId: string) => Promise<void>;
  setFileFocusArea: (fileId: string, focusArea: FocusArea | null) => Promise<void>;
  setIsImporting: (status: boolean) => void;
  optimizeDay: (dayId: string) => Promise<void>;
  syncPendingMutations: () => Promise<void>;
};

const mapActivityFileFromDb = (db: ActivityFileDb): ActivityFile => ({
  id: db.id,
  activityId: db.activity_id,
  tripId: db.trip_id,
  userId: db.user_id,
  fileUrl: db.file_url,
  filePath: db.file_path,
  fileType: db.file_type,
  fileName: db.file_name,
  createdAt: db.created_at,
  focusArea: db.focus_area ?? undefined,
});

const mapActivityFromDb = (db: ActivityDb): Activity => ({
  id: db.id,
  dayId: db.day_id,
  tripId: db.trip_id,
  userId: db.user_id,
  city: db.city ?? "",
  title: db.title,
  time: db.time,
  durationMin: db.duration_min,
  notes: db.notes ?? undefined,
  location: db.location ?? undefined,
  mapsUrl: db.maps_url ?? undefined,
  reservationUrl: db.reservation_url ?? undefined,
  expectedCost: db.expected_cost ?? undefined,
  category: db.category,
  priority: db.priority,
  state: db.state,
  sort_order: db.sort_order,
});

const mapActivityToDb = (activity: Partial<Activity>) => ({
  day_id: activity.dayId,
  trip_id: activity.tripId,
  user_id: activity.userId,
  title: activity.title,
  time: activity.time,
  duration_min: activity.durationMin,
  notes: activity.notes,
  location: activity.location,
  maps_url: activity.mapsUrl,
  reservation_url: activity.reservationUrl,
  expected_cost: activity.expectedCost,
  category: activity.category,
  priority: activity.priority,
  state: activity.state,
  sort_order: activity.sort_order,
});

function buildTripSummaryFromPlan(plan: TripPlan): TripSummary {
  return {
    id: plan.id,
    name: plan.name,
    startDate: plan.startDate,
    endDate: plan.endDate,
    dayCount: plan.days.length,
    activityCount: plan.days.reduce((total, day) => total + day.activities.length, 0),
  };
}

function normalizeTripPlan(plan: TripPlan): TripPlan {
  return {
    ...plan,
    shoppingItems: plan.shoppingItems ?? [],
    ignoredShoppingSuggestionKeys: plan.ignoredShoppingSuggestionKeys ?? [],
  };
}

function buildTripPlan(
  trip: TripDb,
  days: TripDayDb[],
  activities: ActivityDb[],
  reservations: ReservationDb[],
  files: ActivityFileDb[]
): TripPlan {
  const mappedFiles = files.map(mapActivityFileFromDb);

  return {
    id: trip.id,
    name: trip.name,
    userId: trip.user_id,
    startDate: trip.start_date ?? undefined,
    endDate: trip.end_date ?? undefined,
    createdAt: trip.created_at ?? undefined,
    days: days.map((day) => ({
      id: day.id,
      date: day.date,
      city: day.city,
      label: day.label,
      userId: day.user_id,
      activities: activities
        .filter((activity) => activity.day_id === day.id)
        .map((activity) => ({
          ...mapActivityFromDb(activity),
          files: mappedFiles.filter((file) => file.activityId === activity.id),
        })),
    })),
    criticalReservations: reservations.map((reservation) => ({
      id: reservation.id,
      title: reservation.title,
      userId: reservation.user_id,
      bookingDeadline: reservation.booking_deadline,
      reservationDate: reservation.reservation_date,
      bookingLink: reservation.booking_link ?? undefined,
      urgency: reservation.urgency,
      status: reservation.status,
      price: reservation.price ?? undefined,
    })),
    shoppingItems: [],
    ignoredShoppingSuggestionKeys: [],
  };
}

function sortActivities(activities: Activity[]) {
  return [...activities].sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
    return left.time.localeCompare(right.time);
  });
}

function getCurrentUserId() {
  return useAuthStore.getState().user?.id ?? null;
}

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function buildSeedDays(tripId: string, userId: string, startDate: string, endDate: string) {
  const days: TripDay[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  let dayCounter = 1;
  const cursor = new Date(start);

  while (cursor <= end && dayCounter <= 90) {
    days.push({
      id: createOfflineId("day"),
      date: cursor.toISOString().split("T")[0],
      city: "New Destination",
      label: `Day ${dayCounter}`,
      userId,
      activities: [],
    });
    cursor.setDate(cursor.getDate() + 1);
    dayCounter += 1;
  }

  return days.map((day) => ({
    ...day,
    activities: [],
  }));
}

export const useItineraryStore = create<Store>((set, get) => {
  const persistCacheFromState = async () => {
    const userId = getCurrentUserId() ?? get().activeTrip?.userId ?? null;
    if (!userId) return;

    const existingCache = await loadOfflineTripCache(userId);
    const tripPlans = { ...(existingCache?.tripPlans ?? {}) };
    const activeTrip = get().activeTrip;
    if (activeTrip) {
      tripPlans[activeTrip.id] = normalizeTripPlan(activeTrip);
    }

    await saveOfflineTripCache(userId, {
      trips: get().trips,
      tripPlans,
      latestTripId: activeTrip?.id ?? existingCache?.latestTripId ?? null,
      cachedAt: Date.now(),
    });
  };

  const writeState = async (updater: Partial<Store> | ((state: Store) => Partial<Store>)) => {
    set(updater as never);
    const activeTrip = get().activeTrip;
    if (activeTrip) {
      set((state) => ({
        trips: state.trips.some((trip) => trip.id === activeTrip.id)
          ? state.trips.map((trip) => (trip.id === activeTrip.id ? buildTripSummaryFromPlan(activeTrip) : trip))
          : [buildTripSummaryFromPlan(activeTrip), ...state.trips],
      }));
    }
    await persistCacheFromState();
  };

  const removeTripFromCache = async (tripId: string) => {
    const userId = getCurrentUserId() ?? get().activeTrip?.userId ?? null;
    if (!userId) return;

    const cache = await loadOfflineTripCache(userId);
    if (!cache) return;
    const nextTripPlans = { ...cache.tripPlans };
    delete nextTripPlans[tripId];

    await saveOfflineTripCache(userId, {
      trips: cache.trips.filter((trip) => trip.id !== tripId),
      tripPlans: nextTripPlans,
      latestTripId: cache.latestTripId === tripId ? null : cache.latestTripId,
      cachedAt: Date.now(),
    });
  };

  const enqueueMutation = async (
    operation: OfflineMutationQueueEntry["operation"],
    target: OfflineMutationQueueEntry["target"],
    payload: OfflineMutationQueueEntry["payload"]
  ) => {
    const userId = getCurrentUserId() ?? get().activeTrip?.userId;
    if (!userId) return;

    await enqueueOfflineMutation({
      id: createOfflineId("mutation"),
      operation,
      target,
      payload,
      timestamp: Date.now(),
      userId,
      attempts: 0,
      nextRetryAt: 0,
    });

    await useOfflineStore.getState().refreshPendingCount();
  };

  const hydrateFromCache = async (tripId?: string) => {
    const userId = getCurrentUserId();
    if (!userId) {
      set({
        trips: [],
        activeTrip: null,
        activeDayId: "",
        loading: false,
        hasFetched: true,
        error: null,
      });
      return;
    }

    const cache = await loadOfflineTripCache(userId);
    if (!cache) {
      set({
        trips: [],
        activeTrip: null,
        activeDayId: "",
        loading: false,
        hasFetched: true,
        error: null,
      });
      return;
    }

    const resolvedTripId = tripId ?? cache.latestTripId ?? cache.trips[0]?.id ?? null;
    const cachedTrip = resolvedTripId && cache.tripPlans[resolvedTripId]
      ? normalizeTripPlan(cache.tripPlans[resolvedTripId])
      : null;
    const currentActiveDayId = get().activeDayId;
    const nextActiveDayId = cachedTrip?.days.some((day) => day.id === currentActiveDayId)
      ? currentActiveDayId
      : cachedTrip?.days[0]?.id ?? "";

    set({
      trips: cache.trips,
      activeTrip: cachedTrip,
      activeDayId: nextActiveDayId,
      loading: false,
      hasFetched: true,
      error: null,
    });
  };

  const fetchFreshTrip = async (tripId?: string) => {
    const userId = getCurrentUserId();
    let tripQuery = supabase.from("trips").select("*");
    if (tripId) {
      tripQuery = tripQuery.eq("id", tripId);
    } else {
      tripQuery = tripQuery.order("created_at", { ascending: false }).limit(1);
    }

    const { data: trips, error } = await tripQuery;
    if (error) throw error;

    if (!trips || trips.length === 0) {
      set({ activeTrip: null, activeDayId: "", loading: false, hasFetched: true });
      return;
    }

    const trip = trips[0] as TripDb;
    const [{ data: days }, { data: activities }, { data: reservations }, { data: files }] = await Promise.all([
      supabase.from("trip_days").select("*").eq("trip_id", trip.id).order("date", { ascending: true }),
      supabase.from("activities").select("*").eq("trip_id", trip.id).order("sort_order", { ascending: true }),
      supabase.from("critical_reservations").select("*").eq("trip_id", trip.id),
      supabase.from("activity_files").select("*").eq("trip_id", trip.id),
    ]);

    const baseTripPlan = buildTripPlan(
      trip,
      (days ?? []) as TripDayDb[],
      (activities ?? []) as ActivityDb[],
      (reservations ?? []) as ReservationDb[],
      (files ?? []) as ActivityFileDb[]
    );
    const cachedTrip = userId ? (await loadOfflineTripCache(userId))?.tripPlans?.[baseTripPlan.id] : null;
    const tripPlan: TripPlan = normalizeTripPlan({
      ...baseTripPlan,
      shoppingItems: cachedTrip?.shoppingItems ?? [],
      ignoredShoppingSuggestionKeys: cachedTrip?.ignoredShoppingSuggestionKeys ?? [],
    });

    set((state) => {
      const nextTrips = state.trips.some((summary) => summary.id === tripPlan.id)
        ? state.trips.map((summary) => (summary.id === tripPlan.id ? buildTripSummaryFromPlan(tripPlan) : summary))
        : [buildTripSummaryFromPlan(tripPlan), ...state.trips];
      const nextActiveDayId = tripPlan.days.some((day) => day.id === state.activeDayId)
        ? state.activeDayId
        : tripPlan.days[0]?.id ?? "";

      return {
        activeTrip: tripPlan,
        activeDayId: nextActiveDayId,
        trips: nextTrips,
        loading: false,
        hasFetched: true,
        error: null,
      };
    });

    await persistCacheFromState();
  };

  const resolveMappedId = (value: unknown, idMap: Map<string, string>) => {
    if (typeof value !== "string") return value;
    return idMap.get(value) ?? value;
  };

  const processQueueEntry = async (entry: OfflineMutationQueueEntry, idMap: Map<string, string>) => {
    const payload = entry.payload;

    if (entry.target === "trip" && entry.operation === "create") {
      const name = String(payload.name ?? "");
      const startDate = String(payload.startDate ?? new Date().toISOString().split("T")[0]);
      const endDate = String(payload.endDate ?? startDate);
      const userId = entry.userId;
      const { data: newTrip, error } = await supabase
        .from("trips")
        .insert({
          name,
          user_id: userId,
          start_date: startDate,
          end_date: endDate,
        })
        .select()
        .single();

      if (error) throw error;
      idMap.set(String(payload.tripId), String(newTrip.id));
      return;
    }

    if (entry.target === "trip" && entry.operation === "delete") {
      const tripId = String(resolveMappedId(payload.tripId, idMap));
      await supabase.from("activities").delete().eq("trip_id", tripId);
      await supabase.from("critical_reservations").delete().eq("trip_id", tripId);
      await supabase.from("trip_days").delete().eq("trip_id", tripId);
      const { error } = await supabase.from("trips").delete().eq("id", tripId);
      if (error) throw error;
      return;
    }

    if (entry.target === "trip_day" && entry.operation === "create") {
      const tripId = String(resolveMappedId(payload.tripId, idMap));
      const dayId = String(payload.dayId);
      const { data, error } = await supabase
        .from("trip_days")
        .insert({
          trip_id: tripId,
          user_id: entry.userId,
          date: String(payload.date),
          city: String(payload.city),
          label: String(payload.label),
        })
        .select()
        .single();
      if (error) throw error;
      idMap.set(dayId, String(data.id));
      return;
    }

    if (entry.target === "trip_day" && entry.operation === "update") {
      const dayId = String(resolveMappedId(payload.dayId, idMap));
      const updates = payload.updates as Partial<TripDay>;
      const dbPayload: Partial<TripDayDb> = {};
      if (updates.date !== undefined) dbPayload.date = updates.date;
      if (updates.city !== undefined) dbPayload.city = updates.city;
      if (updates.label !== undefined) dbPayload.label = updates.label;
      const { error } = await supabase.from("trip_days").update(dbPayload).eq("id", dayId);
      if (error) throw error;
      return;
    }

    if (entry.target === "trip_day" && entry.operation === "delete") {
      const dayId = String(resolveMappedId(payload.dayId, idMap));
      await supabase.from("activities").delete().eq("day_id", dayId);
      const { error } = await supabase.from("trip_days").delete().eq("id", dayId);
      if (error) throw error;
      return;
    }

    if (entry.target === "activity" && entry.operation === "create") {
      const activity = payload.activity as Activity;
      const originalId = activity.id;
      const dbPayload = {
        ...mapActivityToDb({
          ...activity,
          dayId: String(resolveMappedId(activity.dayId, idMap)),
          tripId: String(resolveMappedId(activity.tripId, idMap)),
          userId: entry.userId,
        }),
      };
      const { data, error } = await supabase.from("activities").insert(dbPayload).select().single();
      if (error) throw error;
      idMap.set(originalId, String((data as ActivityDb).id));
      return;
    }

    if (entry.target === "activity" && entry.operation === "update") {
      const activityId = String(resolveMappedId(payload.activityId, idMap));
      const patch = payload.patch as Partial<Activity>;
      const { error } = await supabase.from("activities").update(mapActivityToDb(patch)).eq("id", activityId);
      if (error) throw error;
      return;
    }

    if (entry.target === "activity" && entry.operation === "delete") {
      const activityId = String(resolveMappedId(payload.activityId, idMap));
      const { error } = await supabase.from("activities").delete().eq("id", activityId);
      if (error) throw error;
      return;
    }

    if (entry.target === "activity_state" && entry.operation === "update") {
      const activityId = String(resolveMappedId(payload.activityId, idMap));
      const { error } = await supabase.from("activities").update({ state: payload.state }).eq("id", activityId);
      if (error) throw error;
      return;
    }

    if (entry.target === "activity_reorder" && entry.operation === "update") {
      const orderedActivityIds = Array.isArray(payload.orderedActivityIds)
        ? payload.orderedActivityIds.map((id, index) => ({
            id: String(resolveMappedId(id, idMap)),
            sort_order: index,
          }))
        : [];
      if (orderedActivityIds.length === 0) return;
      const { error } = await supabase.from("activities").upsert(orderedActivityIds);
      if (error) throw error;
      return;
    }

    if (entry.target === "reservation" && entry.operation === "create") {
      const reservation = payload.reservation as CriticalReservation & { tripId: string };
      const originalId = reservation.id;
      const { data, error } = await supabase
        .from("critical_reservations")
        .insert({
          trip_id: String(resolveMappedId(reservation.tripId, idMap)),
          user_id: entry.userId,
          title: reservation.title,
          booking_deadline: reservation.bookingDeadline,
          reservation_date: reservation.reservationDate,
          booking_link: reservation.bookingLink,
          urgency: reservation.urgency,
          status: reservation.status,
          price: reservation.price,
        })
        .select()
        .single();
      if (error) throw error;
      idMap.set(originalId, String((data as ReservationDb).id));
      return;
    }

    if (entry.target === "reservation" && entry.operation === "update") {
      const reservationId = String(resolveMappedId(payload.reservationId, idMap));
      const patch = payload.patch as Partial<CriticalReservation>;
      const dbPayload: Partial<ReservationDb> = {};
      if (patch.title !== undefined) dbPayload.title = patch.title;
      if (patch.bookingDeadline !== undefined) dbPayload.booking_deadline = patch.bookingDeadline;
      if (patch.reservationDate !== undefined) dbPayload.reservation_date = patch.reservationDate;
      if (patch.bookingLink !== undefined) dbPayload.booking_link = patch.bookingLink;
      if (patch.urgency !== undefined) dbPayload.urgency = patch.urgency;
      if (patch.status !== undefined) dbPayload.status = patch.status;
      if (patch.price !== undefined) dbPayload.price = patch.price;
      const { error } = await supabase.from("critical_reservations").update(dbPayload).eq("id", reservationId);
      if (error) throw error;
      return;
    }

    if (entry.target === "reservation" && entry.operation === "delete") {
      const reservationId = String(resolveMappedId(payload.reservationId, idMap));
      const { error } = await supabase.from("critical_reservations").delete().eq("id", reservationId);
      if (error) throw error;
      return;
    }

    if (entry.target === "activity_file" && entry.operation === "create") {
      const activityId = String(resolveMappedId(payload.activityId, idMap));
      const tripId = String(resolveMappedId(payload.tripId, idMap));
      const file = payload.file as File;
      const originalId = String(payload.fileId);
      const timestamp = Date.now();
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const filePath = `${entry.userId}/${activityId}/${timestamp}_${sanitizedFileName}`;

      const { error: storageError } = await supabase.storage.from("activity-files").upload(filePath, file);
      if (storageError) throw storageError;

      const { data: { publicUrl } } = supabase.storage.from("activity-files").getPublicUrl(filePath);
      const fileType = file.type.includes("pdf") ? "pdf" : file.type.includes("image") ? "image" : "other";

      const { data, error } = await supabase
        .from("activity_files")
        .insert({
          activity_id: activityId,
          trip_id: tripId,
          user_id: entry.userId,
          file_url: publicUrl,
          file_path: filePath,
          file_type: fileType,
          file_name: file.name,
        })
        .select()
        .single();
      if (error) throw error;
      idMap.set(originalId, String((data as ActivityFileDb).id));
      return;
    }

    if (entry.target === "activity_file" && entry.operation === "delete") {
      const fileId = String(resolveMappedId(payload.fileId, idMap));
      const { data: fileRow, error: fetchError } = await supabase
        .from("activity_files")
        .select("file_path, file_url")
        .eq("id", fileId)
        .single();
      if (fetchError) throw fetchError;

      await supabase.storage.from("activity-files").remove([String(fileRow.file_path)]);
      const { error } = await supabase.from("activity_files").delete().eq("id", fileId);
      if (error) throw error;
      await removeCachedDocument(String(fileRow.file_url));
      return;
    }

    if (entry.target === "file_focus_area" && entry.operation === "update") {
      const fileId = String(resolveMappedId(payload.fileId, idMap));
      const { error } = await supabase.from("activity_files").update({ focus_area: payload.focusArea }).eq("id", fileId);
      if (error) throw error;
    }
  };

  return {
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
      const userId = getCurrentUserId();
      if (!userId) {
        set({ trips: [], hasFetched: true, loading: false, error: null });
        return;
      }

      if (!isOnline()) {
        const cache = await loadOfflineTripCache(userId);
        set({
          trips: cache?.trips ?? [],
          loading: false,
          hasFetched: true,
          error: null,
        });
        return;
      }

      try {
        const { data, error } = await supabase
          .from("trips")
          .select("id, name, user_id, start_date, end_date, trip_days(count), activities(count)")
          .order("created_at", { ascending: false });
        if (error) throw error;

        const trips = (data ?? []).map((trip) => ({
          id: String(trip.id),
          name: String(trip.name),
          startDate: trip.start_date ?? undefined,
          endDate: trip.end_date ?? undefined,
          dayCount: Number((trip.trip_days as { count: number }[])[0]?.count ?? 0),
          activityCount: Number((trip.activities as { count: number }[])[0]?.count ?? 0),
        }));

        set({ trips, error: null, hasFetched: true, loading: false });
        await persistCacheFromState();
      } catch (error) {
        console.error("Plania: fetchAllTrips error", error);
        await hydrateFromCache();
      }
    },

    fetchActiveTrip: async (tripId, skipLoading = false) => {
      if (!skipLoading) set({ loading: true, error: null, hasFetched: false });
      else set({ error: null });

      if (!isOnline()) {
        await hydrateFromCache(tripId);
        return;
      }

      try {
        await fetchFreshTrip(tripId);
      } catch (error) {
        console.error("Plania: fetchActiveTrip error", error);
        await hydrateFromCache(tripId);
      }
    },

    createTrip: async (name, startDate, endDate) => {
      const userId = getCurrentUserId();
      if (!userId) return;

      const finalStartDate = startDate || new Date().toISOString().split("T")[0];
      const finalEndDate = endDate || finalStartDate;

      if (!isOnline()) {
        const tripId = createOfflineId("trip");
        const days = buildSeedDays(tripId, userId, finalStartDate, finalEndDate);
        const tripPlan: TripPlan = {
          id: tripId,
          name,
          userId,
          startDate: finalStartDate,
          endDate: finalEndDate,
          createdAt: new Date().toISOString(),
          days,
          criticalReservations: [],
          shoppingItems: [],
          ignoredShoppingSuggestionKeys: [],
        };

        await writeState((state) => ({
          activeTrip: tripPlan,
          activeDayId: days[0]?.id ?? "",
          trips: [buildTripSummaryFromPlan(tripPlan), ...state.trips.filter((trip) => trip.id !== tripId)],
          hasFetched: true,
          loading: false,
          error: null,
        }));

        await enqueueMutation("create", "trip", {
          tripId,
          name,
          startDate: finalStartDate,
          endDate: finalEndDate,
        });
        return;
      }

      set({ loading: true });
      const { data: newTrip, error } = await supabase
        .from("trips")
        .insert({
          name,
          user_id: userId,
          start_date: finalStartDate,
          end_date: finalEndDate,
        })
        .select()
        .single();

      if (error) {
        set({ loading: false, error: error.message });
        return;
      }

      const daysToCreate = buildSeedDays(String(newTrip.id), userId, finalStartDate, finalEndDate).map((day) => ({
        trip_id: String(newTrip.id),
        user_id: userId,
        date: day.date,
        city: day.city,
        label: day.label,
      }));

      if (daysToCreate.length > 0) {
        await supabase.from("trip_days").insert(daysToCreate);
      }

      await get().fetchActiveTrip(String(newTrip.id), true);
    },

    deleteTrip: async (tripId) => {
      const previousTrips = get().trips;
      const nextTrips = previousTrips.filter((trip) => trip.id !== tripId);
      const nextActiveTrip = get().activeTrip?.id === tripId ? null : get().activeTrip;

      await writeState({
        trips: nextTrips,
        activeTrip: nextActiveTrip,
        activeDayId: nextActiveTrip?.days[0]?.id ?? "",
        loading: false,
        error: null,
      });
      await removeTripFromCache(tripId);

      if (!isOnline()) {
        await enqueueMutation("delete", "trip", { tripId });
        return;
      }

      try {
        await supabase.from("activities").delete().eq("trip_id", tripId);
        await supabase.from("critical_reservations").delete().eq("trip_id", tripId);
        await supabase.from("trip_days").delete().eq("trip_id", tripId);
        const { error } = await supabase.from("trips").delete().eq("id", tripId);
        if (error) throw error;
      } catch (error) {
        console.error("Plania: deleteTrip error", error);
        set({ error: error instanceof Error ? error.message : "Failed to delete trip" });
      }
    },

    switchTrip: async (tripId) => {
      await get().fetchActiveTrip(tripId, true);
    },

    clearData: () => {
      set({
        activeTrip: null,
        trips: [],
        activeDayId: "",
        hasFetched: false,
        loading: false,
        error: null,
      });
    },

    addTripDay: async (date, city, label) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return;

      const dayId = createOfflineId("day");
      const newDay: TripDay = {
        id: dayId,
        date,
        city,
        label,
        userId: String(activeTrip.userId ?? ""),
        activities: [],
      };

      await writeState((state) => ({
        activeTrip: state.activeTrip
          ? {
              ...state.activeTrip,
              days: [...state.activeTrip.days, newDay].sort((left, right) => left.date.localeCompare(right.date)),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("create", "trip_day", {
          tripId: activeTrip.id,
          dayId,
          date,
          city,
          label,
        });
        return;
      }

      const { error } = await supabase.from("trip_days").insert({
        trip_id: activeTrip.id,
        user_id: activeTrip.userId,
        date,
        city,
        label,
      });

      if (error) {
        set({ error: error.message });
      } else {
        await get().fetchActiveTrip(activeTrip.id);
      }
    },

    removeTripDay: async (dayId) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return;

      await writeState((state) => ({
        activeTrip: state.activeTrip
          ? {
              ...state.activeTrip,
              days: state.activeTrip.days.filter((day) => day.id !== dayId),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("delete", "trip_day", { dayId });
        return;
      }

      await supabase.from("activities").delete().eq("day_id", dayId);
      const { error } = await supabase.from("trip_days").delete().eq("id", dayId);
      if (error) {
        set({ error: error.message });
      }
    },

    updateTripDay: async (dayId, updates) => {
      await writeState((state) => ({
        activeTrip: state.activeTrip
          ? {
              ...state.activeTrip,
              days: state.activeTrip.days.map((day) => (day.id === dayId ? { ...day, ...updates } : day)),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "trip_day", { dayId, updates });
        return;
      }

      const dbPayload: Partial<TripDayDb> = {};
      if (updates.date !== undefined) dbPayload.date = updates.date;
      if (updates.city !== undefined) dbPayload.city = updates.city;
      if (updates.label !== undefined) dbPayload.label = updates.label;
      const { error } = await supabase.from("trip_days").update(dbPayload).eq("id", dayId);
      if (error) set({ error: error.message });
    },

    setActiveDay: (activeDayId) => set({ activeDayId }),

    setDayScroll: (dayId, y) =>
      set((state) => ({ dayScrollY: { ...state.dayScrollY, [dayId]: y } })),

    addActivity: async (activity) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return;

      const newActivity: Activity = {
        ...activity,
        id: createOfflineId("activity"),
        tripId: activeTrip.id,
        userId: String(activeTrip.userId ?? ""),
      };

      await writeState((state) => ({
        activeTrip: state.activeTrip
          ? {
              ...state.activeTrip,
              days: state.activeTrip.days.map((day) =>
                day.id === activity.dayId
                  ? { ...day, activities: sortActivities([...day.activities, newActivity]) }
                  : day
              ),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("create", "activity", { activity: newActivity });
        return;
      }

      const { error } = await supabase.from("activities").insert({
        ...mapActivityToDb(newActivity),
        trip_id: activeTrip.id,
        user_id: activeTrip.userId,
      });
      if (error) set({ error: error.message });
      else await get().fetchActiveTrip(activeTrip.id, true);
    },

    updateActivityState: async (dayId, activityId, state) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              days: current.activeTrip.days.map((day) =>
                day.id === dayId
                  ? {
                      ...day,
                      activities: day.activities.map((activity) =>
                        activity.id === activityId ? { ...activity, state } : activity
                      ),
                    }
                  : day
              ),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "activity_state", { dayId, activityId, state });
        return;
      }

      const { error } = await supabase.from("activities").update({ state }).eq("id", activityId);
      if (error) set({ error: error.message });
    },

    patchActivity: async (dayId, activityId, patch) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              days: current.activeTrip.days.map((day) =>
                day.id === dayId
                  ? {
                      ...day,
                      activities: day.activities.map((activity) =>
                        activity.id === activityId ? { ...activity, ...patch } : activity
                      ),
                    }
                  : day
              ),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "activity", { dayId, activityId, patch });
        return;
      }

      const { error } = await supabase.from("activities").update(mapActivityToDb(patch)).eq("id", activityId);
      if (error) set({ error: error.message });
    },

    removeActivity: async (dayId, activityId) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              days: current.activeTrip.days.map((day) =>
                day.id === dayId
                  ? { ...day, activities: day.activities.filter((activity) => activity.id !== activityId) }
                  : day
              ),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("delete", "activity", { dayId, activityId });
        return;
      }

      const { error } = await supabase.from("activities").delete().eq("id", activityId);
      if (error) set({ error: error.message });
    },

    reorderActivities: async (dayId, sourceId, targetId) => {
      const day = get().activeTrip?.days.find((item) => item.id === dayId);
      if (!day) return;
      const activities = [...day.activities];
      const sourceIndex = activities.findIndex((activity) => activity.id === sourceId);
      const targetIndex = activities.findIndex((activity) => activity.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const [moved] = activities.splice(sourceIndex, 1);
      activities.splice(targetIndex, 0, moved);
      const orderedActivities = activities.map((activity, index) => ({ ...activity, sort_order: index }));

      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              days: current.activeTrip.days.map((item) =>
                item.id === dayId ? { ...item, activities: orderedActivities } : item
              ),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "activity_reorder", {
          dayId,
          orderedActivityIds: orderedActivities.map((activity) => activity.id),
        });
        return;
      }

      const { error } = await supabase
        .from("activities")
        .upsert(orderedActivities.map((activity, index) => ({ id: activity.id, sort_order: index })));
      if (error) set({ error: error.message });
    },

    toggleBooking: async (bookingId) => {
      const booking = get().activeTrip?.criticalReservations.find((item) => item.id === bookingId);
      if (!booking) return;

      const status = booking.status === "booked" ? "pending" : "booked";
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              criticalReservations: current.activeTrip.criticalReservations.map((reservation) =>
                reservation.id === bookingId ? { ...reservation, status } : reservation
              ),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "reservation", {
          reservationId: bookingId,
          patch: { status },
        });
        return;
      }

      const { error } = await supabase.from("critical_reservations").update({ status }).eq("id", bookingId);
      if (error) set({ error: error.message });
    },

    duplicateActivity: async (dayId, activityId) => {
      const activity = get().activeTrip?.days.find((day) => day.id === dayId)?.activities.find((item) => item.id === activityId);
      if (!activity) return;

      await get().addActivity({
        dayId,
        city: activity.city,
        title: `${activity.title} (Copy)`,
        time: activity.time,
        durationMin: activity.durationMin,
        notes: activity.notes,
        location: activity.location,
        mapsUrl: activity.mapsUrl,
        reservationUrl: activity.reservationUrl,
        expectedCost: activity.expectedCost,
        category: activity.category,
        priority: activity.priority,
        state: "pending",
        sort_order: activity.sort_order + 1,
        files: [],
      });
    },

    addImportedActivities: async (dayId, activities) => {
      for (const [index, activity] of activities.entries()) {
        await get().addActivity({
          ...activity,
          dayId,
          sort_order: 10_000 + index,
        });
      }
    },

    addReservation: async (reservation) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return;

      const newReservation: CriticalReservation = {
        id: createOfflineId("reservation"),
        userId: String(activeTrip.userId ?? ""),
        ...reservation,
      };

      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              criticalReservations: [...current.activeTrip.criticalReservations, newReservation],
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("create", "reservation", {
          reservation: {
            ...newReservation,
            tripId: activeTrip.id,
          },
        });
        return;
      }

      const { error } = await supabase.from("critical_reservations").insert({
        trip_id: activeTrip.id,
        user_id: activeTrip.userId,
        title: reservation.title,
        booking_deadline: reservation.bookingDeadline,
        reservation_date: reservation.reservationDate,
        booking_link: reservation.bookingLink,
        urgency: reservation.urgency,
        status: reservation.status,
        price: reservation.price,
      });
      if (error) set({ error: error.message });
      else await get().fetchActiveTrip(activeTrip.id, true);
    },

    patchReservation: async (reservationId, patch) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              criticalReservations: current.activeTrip.criticalReservations.map((reservation) =>
                reservation.id === reservationId ? { ...reservation, ...patch } : reservation
              ),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "reservation", { reservationId, patch });
        return;
      }

      const dbPayload: Partial<ReservationDb> = {};
      if (patch.title !== undefined) dbPayload.title = patch.title;
      if (patch.bookingDeadline !== undefined) dbPayload.booking_deadline = patch.bookingDeadline;
      if (patch.reservationDate !== undefined) dbPayload.reservation_date = patch.reservationDate;
      if (patch.bookingLink !== undefined) dbPayload.booking_link = patch.bookingLink;
      if (patch.urgency !== undefined) dbPayload.urgency = patch.urgency;
      if (patch.status !== undefined) dbPayload.status = patch.status;
      if (patch.price !== undefined) dbPayload.price = patch.price;
      const { error } = await supabase.from("critical_reservations").update(dbPayload).eq("id", reservationId);
      if (error) set({ error: error.message });
    },

    removeReservation: async (reservationId) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              criticalReservations: current.activeTrip.criticalReservations.filter((reservation) => reservation.id !== reservationId),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("delete", "reservation", { reservationId });
        return;
      }

      const { error } = await supabase.from("critical_reservations").delete().eq("id", reservationId);
      if (error) set({ error: error.message });
    },

    addShoppingItems: async (items) => {
      await writeState((current) => {
        if (!current.activeTrip) return {};

        const existingKeys = new Set(current.activeTrip.shoppingItems.map((item) => item.name.trim().toLowerCase()));
        const nextItems = items
          .filter((item) => !existingKeys.has(item.name.trim().toLowerCase()))
          .map((item) => ({
            ...item,
            id: item.id || createOfflineId("shopping"),
            status: item.status || "pending",
          }));

        return {
          activeTrip: {
            ...current.activeTrip,
            shoppingItems: [...current.activeTrip.shoppingItems, ...nextItems],
          },
        };
      });
    },

    toggleShoppingItemStatus: async (itemId) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              shoppingItems: current.activeTrip.shoppingItems.map((item) =>
                item.id === itemId
                  ? { ...item, status: item.status === "purchased" ? "pending" : "purchased" }
                  : item
              ),
            }
          : null,
      }));
    },

    updateShoppingItem: async (itemId, patch) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              shoppingItems: current.activeTrip.shoppingItems.map((item) =>
                item.id === itemId ? { ...item, ...patch } : item
              ),
            }
          : null,
      }));
    },

    removeShoppingItem: async (itemId) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              shoppingItems: current.activeTrip.shoppingItems.filter((item) => item.id !== itemId),
            }
          : null,
      }));
    },

    ignoreShoppingSuggestion: async (ignoreKey) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              ignoredShoppingSuggestionKeys: current.activeTrip.ignoredShoppingSuggestionKeys.includes(ignoreKey)
                ? current.activeTrip.ignoredShoppingSuggestionKeys
                : [...current.activeTrip.ignoredShoppingSuggestionKeys, ignoreKey],
            }
          : null,
      }));
    },

    uploadActivityFile: async (activityId, file) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return;

      const tempFile: ActivityFile = {
        id: createOfflineId("file"),
        activityId,
        tripId: activeTrip.id,
        userId: String(activeTrip.userId ?? ""),
        fileUrl: URL.createObjectURL(file),
        filePath: "",
        fileType: file.type.includes("pdf") ? "pdf" : file.type.includes("image") ? "image" : "other",
        fileName: file.name,
        createdAt: new Date().toISOString(),
      };

      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              days: current.activeTrip.days.map((day) => ({
                ...day,
                activities: day.activities.map((activity) =>
                  activity.id === activityId
                    ? { ...activity, files: [...(activity.files ?? []), tempFile] }
                    : activity
                ),
              })),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("create", "activity_file", {
          fileId: tempFile.id,
          activityId,
          tripId: activeTrip.id,
          file,
        });
        return;
      }

      const timestamp = Date.now();
      const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const filePath = `${activeTrip.userId}/${activityId}/${timestamp}_${sanitizedFileName}`;
      const { error: storageError } = await supabase.storage.from("activity-files").upload(filePath, file);
      if (storageError) {
        set({ error: storageError.message });
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from("activity-files").getPublicUrl(filePath);
      const { error } = await supabase.from("activity_files").insert({
        activity_id: activityId,
        trip_id: activeTrip.id,
        user_id: activeTrip.userId,
        file_url: publicUrl,
        file_path: filePath,
        file_type: tempFile.fileType,
        file_name: file.name,
      });
      if (error) set({ error: error.message });
      else await get().fetchActiveTrip(activeTrip.id, true);
    },

    deleteActivityFile: async (fileId) => {
      const currentFile = get().activeTrip?.days
        .flatMap((day) => day.activities)
        .flatMap((activity) => activity.files ?? [])
        .find((file) => file.id === fileId);

      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              days: current.activeTrip.days.map((day) => ({
                ...day,
                activities: day.activities.map((activity) => ({
                  ...activity,
                  files: (activity.files ?? []).filter((file) => file.id !== fileId),
                })),
              })),
            }
          : null,
      }));

      if (currentFile) {
        await removeCachedDocument(currentFile.fileUrl);
      }

      if (!isOnline()) {
        await enqueueMutation("delete", "activity_file", { fileId });
        return;
      }

      const { data: file, error: fetchError } = await supabase
        .from("activity_files")
        .select("file_path, file_url")
        .eq("id", fileId)
        .single();
      if (fetchError) {
        set({ error: fetchError.message });
        return;
      }

      await supabase.storage.from("activity-files").remove([String(file.file_path)]);
      const { error } = await supabase.from("activity_files").delete().eq("id", fileId);
      if (error) set({ error: error.message });
    },

    setFileFocusArea: async (fileId, focusArea) => {
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              days: current.activeTrip.days.map((day) => ({
                ...day,
                activities: day.activities.map((activity) => ({
                  ...activity,
                  files: (activity.files ?? []).map((file) =>
                    file.id === fileId ? { ...file, focusArea: focusArea ?? undefined } : file
                  ),
                })),
              })),
            }
          : null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "file_focus_area", { fileId, focusArea });
        return;
      }

      const { error } = await supabase.from("activity_files").update({ focus_area: focusArea }).eq("id", fileId);
      if (error) set({ error: error.message });
    },

    setIsImporting: (status) => set({ isImporting: status }),

    optimizeDay: async (dayId) => {
      const activeTrip = get().activeTrip;
      const day = activeTrip?.days.find((item) => item.id === dayId);
      if (!activeTrip || !day) return;

      if (!isOnline()) {
        await enqueueMutation("update", "activity_reorder", {
          dayId,
          orderedActivityIds: day.activities.map((activity) => activity.id),
        });
        return;
      }

      set({ isOptimizing: true, error: null });
      try {
        const response = await fetch("/api/optimize-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: day.date, activities: day.activities }),
        });

        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as { optimizedActivities: Activity[] };
        const oldIds = day.activities.map((activity) => activity.id);
        if (oldIds.length > 0) {
          await supabase.from("activities").delete().in("id", oldIds);
        }

        await supabase.from("activities").insert(
          data.optimizedActivities.map((activity, index) => ({
            ...mapActivityToDb({
              ...activity,
              dayId,
              tripId: activeTrip.id,
              userId: String(activeTrip.userId ?? ""),
              sort_order: index,
            }),
            trip_id: activeTrip.id,
            user_id: activeTrip.userId,
            day_id: dayId,
            sort_order: index,
          }))
        );

        await get().fetchActiveTrip(activeTrip.id, true);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "Failed to optimize day" });
      } finally {
        set({ isOptimizing: false });
      }
    },

    syncPendingMutations: async () => {
      if (!isOnline()) return;

      const pendingEntries = await listOfflineMutations();
      if (pendingEntries.length === 0) {
        await useOfflineStore.getState().refreshPendingCount();
        return;
      }

      useOfflineStore.getState().setSyncing(true);
      useOfflineStore.getState().setLastSyncError(null);
      const idMap = new Map<string, string>();

      for (const entry of pendingEntries) {
        if (entry.nextRetryAt > Date.now()) continue;

        try {
          await processQueueEntry(entry, idMap);
          await deleteOfflineMutation(entry.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Offline sync failed";
          console.error("Plania: sync conflict/failure", entry, error);
          useOfflineStore.getState().setLastSyncError(message);

          await enqueueOfflineMutation({
            ...entry,
            attempts: entry.attempts + 1,
            nextRetryAt: Date.now() + getRetryDelayMs(entry.attempts + 1),
            lastError: message,
          });
          await deleteOfflineMutation(entry.id);
          break;
        }
      }

      await useOfflineStore.getState().refreshPendingCount();
      useOfflineStore.getState().setSyncing(false);

      const activeTripId = get().activeTrip?.id;
      if (activeTripId && !isOfflineId(activeTripId)) {
        await get().fetchActiveTrip(activeTripId, true);
      } else {
        await get().fetchAllTrips();
        await get().fetchActiveTrip(undefined, true);
      }
    },
  };
});
