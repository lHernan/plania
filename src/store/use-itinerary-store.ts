"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { DayPlanOps } from "@/lib/day-genius/apply";
import {
  SHOPPING_TABLE,
  isMissingShoppingTable,
  isUuid,
  loadShoppingItems,
  shoppingItemToDb,
  shoppingPatchToDb,
} from "@/lib/shopping/db";
import {
  isMissingPackingTable,
  loadTripPacking,
  packingListToRecords,
  recordsOf,
  savePackingMeta,
  writePackingChange,
  type PackingPatch,
} from "@/lib/packing-sync";
import { removeCachedDocument } from "@/lib/offline-documents";
import { getCurrentDateString, resolveTripSelection } from "@/lib/trip-selection";
import {
  createOfflineId,
  deleteOfflineMutation,
  enqueueOfflineMutation,
  getRetryDelayMs,
  isOfflineId,
  listOfflineMutations,
  loadOfflineTripCache,
  saveOfflineTripCache,
  clearOfflineTripCache,
  type OfflineMutationQueueEntry,
} from "@/lib/offline-state";
import type {
  Activity,
  ActivityFile,
  ActivityOrigin,
  ActivityState,
  BookingDetails,
  CriticalReservation,
  FocusArea,
  PackingList,
  PackingRecord,
  PackingScope,
  SharedTripSummary,
  ShoppingItem,
  TripDay,
  TripPlan,
  TripShareUser,
  TripSummary,
  TravelContext,
} from "@/lib/types";
import { getCurrentTripDateTime, parseTravelContext } from "@/lib/travel-context";
import { resolvePreferredCurrency, withTripCurrency } from "@/lib/trip-currency";
import { tripTimeZone } from "@/lib/day-genius/context";
import { consecutiveDates, isTripUndated, withoutUndatedFlag } from "@/lib/trip-undated";
import {
  TRIP_COVERS_BUCKET,
  canEditTripCover,
  tripCoverObjectPath,
  validateTripCoverFile,
  type TripCoverError,
} from "@/lib/trip-cover";
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
  actual_cost?: number | null;
  category: Activity["category"];
  priority: Activity["priority"];
  state: ActivityState;
  sort_order: number;
  time_confidence?: number | null;
  time_inferred?: boolean | null;
  origin?: ActivityOrigin | null;
  booking?: BookingDetails | null;
};

type TripDb = {
  id: string;
  name: string;
  user_id: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  is_favorite?: boolean | null;
  travel_context?: unknown;
  /** Absent until trip_covers_migration.sql runs; select("*") never fails over it. */
  cover_path?: string | null;
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

export type NewActivity = Omit<Activity, "id" | "tripId" | "userId">;

type Store = {
  activeTrip: TripPlan | null;
  activeTripIsDraft: boolean;
  trips: TripSummary[];
  sharedTrips: SharedTripSummary[];
  tripShares: TripShareUser[];
  sharesLoading: boolean;
  activeDayId: string;
  dayScrollY: Record<string, number>;
  loading: boolean;
  isImporting: boolean;
  hasFetched: boolean;
  error: string | null;
  fetchAllTrips: () => Promise<void>;
  fetchSharedTrips: () => Promise<void>;
    shareTrip: (tripId: string, email: string, role?: "viewer" | "editor") => Promise<{ error?: string }>;
  fetchTripShares: (tripId: string) => Promise<void>;
    revokeTripShare: (tripId: string, userId: string) => Promise<void>;
    updateTripShareRole: (tripId: string, userId: string, role: "viewer" | "editor") => Promise<void>;
  fetchActiveTrip: (tripId?: string, skipLoading?: boolean) => Promise<void>;
    createTrip: (name: string, startDate?: string, endDate?: string) => Promise<void>;
    cloneTrip: (template: TripPlan, name?: string, startDate?: string) => Promise<void>;
    loadTemplate: (template: TripPlan) => void;
    saveDraft: () => Promise<{ error?: string }>;
  deleteTrip: (tripId: string) => Promise<void>;
  setTripFavorite: (tripId: string) => Promise<void>;
  saveTravelContext: (travelContext: TravelContext | null) => Promise<{ error?: string }>;
  /** [Fijar fechas] of an undated trip: consecutive day dates from `startDate`; "offline" without a connection. */
  setTripDates: (startDate: string) => Promise<{ error?: string }>;
  /**
   * Uploads a new cover (owner or editor, saved trip, online) to trip-covers/<tripId>/, points
   * the trip at it and removes the previous object. Invalid files are rejected before any request.
   */
  setTripCover: (file: File) => Promise<{ error?: TripCoverError }>;
  /** Back to the default placeholder: clears the trip's cover and removes its object. */
  removeTripCover: () => Promise<{ error?: TripCoverError }>;
  switchTrip: (tripId: string) => Promise<void>;
  clearData: () => void;
  addTripDay: (date: string, city: string, label: string) => Promise<void>;
  removeTripDay: (dayId: string) => Promise<void>;
  updateTripDay: (dayId: string, updates: Partial<TripDay>) => Promise<void>;
  setActiveDay: (dayId: string) => void;
  setDayScroll: (dayId: string, y: number) => void;
  addActivity: (activity: Omit<Activity, "id" | "tripId" | "userId">) => Promise<void>;
  /** Optimistic update; rolls back and resolves false when the remote write fails. */
  updateActivityState: (dayId: string, activityId: string, state: ActivityState) => Promise<boolean>;
  patchActivity: (dayId: string, activityId: string, patch: Partial<Activity>) => Promise<void>;
  removeActivity: (dayId: string, activityId: string) => Promise<void>;
  reorderActivities: (dayId: string, sourceId: string, targetId: string) => Promise<void>;
  reorderActivitiesToOrder: (dayId: string, orderedActivityIds: string[]) => Promise<void>;
  toggleBooking: (bookingId: string) => Promise<void>;
  duplicateActivity: (dayId: string, activityId: string) => Promise<void>;
  addImportedActivities: (dayId: string, activities: Omit<Activity, "id" | "dayId" | "sort_order" | "tripId" | "userId">[]) => Promise<void>;
  /**
   * Inserts several activities (possibly on different days) in one request with client-generated
   * ids, refetching once. Online only. All-or-nothing: on failure nothing stays in the itinerary.
   */
  addActivitiesBatch: (activities: NewActivity[]) => Promise<{ ok: true; ids: string[] } | { ok: false; error: string }>;
  addReservation: (reservation: Omit<CriticalReservation, "id" | "userId">) => Promise<void>;
  patchReservation: (reservationId: string, patch: Partial<CriticalReservation>) => Promise<void>;
  removeReservation: (reservationId: string) => Promise<void>;
  addShoppingItems: (items: ShoppingItem[]) => Promise<void>;
  toggleShoppingItemStatus: (itemId: string) => Promise<void>;
  updateShoppingItem: (itemId: string, patch: Partial<ShoppingItem>) => Promise<void>;
  removeShoppingItem: (itemId: string) => Promise<void>;
  ignoreShoppingSuggestion: (ignoreKey: string) => Promise<void>;
  /** Generation: replaces the chosen packing list (mine, or the shared one) with a new one. */
  replacePackingList: (scope: PackingScope, list: PackingList) => Promise<void>;
  /** Adds a manual item to the first category of the chosen list. */
  addPackingItem: (scope: PackingScope, name: string) => Promise<void>;
  togglePackingItem: (itemId: string) => Promise<void>;
  /** Shared list only: who brings the item (a trip member), or nobody. */
  assignPackingItem: (itemId: string, userId: string | null) => Promise<void>;
  removePackingItem: (itemId: string) => Promise<void>;
  uploadActivityFile: (activityId: string, file: File) => Promise<void>;
  deleteActivityFile: (fileId: string) => Promise<void>;
  setFileFocusArea: (fileId: string, focusArea: FocusArea | null) => Promise<void>;
  setIsImporting: (status: boolean) => void;
  /**
   * Applies the changes accepted from the day genius: field updates (time, duration, day,
   * order) and new suggested activities. Never deletes. Online only; when an update fails,
   * the updates already applied are restored.
   */
  applyDayPlan: (ops: DayPlanOps) => Promise<{ ok: true } | { ok: false; error: string }>;
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

export const mapActivityFromDb = (db: ActivityDb): Activity => ({
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
  // Undefined when the column is absent or empty; select("*") never fails over it.
  actualCost: db.actual_cost ?? undefined,
  category: db.category,
  priority: db.priority,
  state: db.state,
  sort_order: db.sort_order,
  timeConfidence: db.time_confidence ?? undefined,
  timeInferred: db.time_inferred ?? false,
  // Undefined (not "manual") when the column is absent, so rows read before the migration
  // never write an origin column back.
  origin: db.origin ?? undefined,
  booking: db.booking ?? undefined,
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
  time_confidence: activity.timeConfidence,
  time_inferred: activity.timeInferred,
  // Only when set: postgrest-js turns every key of an array insert into a column, so an
  // undefined origin would be sent as NULL (or as an unknown column before the migration).
  ...(activity.origin !== undefined ? { origin: activity.origin } : {}),
  ...(activity.booking !== undefined ? { booking: activity.booking } : {}),
  // Only when the user set it (null clears it), for the same reason as origin.
  ...(activity.actualCost !== undefined ? { actual_cost: activity.actualCost } : {}),
});

/**
 * Array inserts list the union of all row keys as columns (postgrest-js), so rows must share
 * the same keys: when any row carries an origin, the others get "manual" instead of NULL.
 */
function withUniformOrigin<T extends { origin?: ActivityOrigin }>(rows: T[]): T[] {
  if (!rows.some((row) => row.origin !== undefined)) return rows;
  return rows.map((row) => (row.origin === undefined ? { ...row, origin: "manual" as const } : row));
}

function buildTripSummaryFromPlan(plan: TripPlan): TripSummary {
  return {
    id: plan.id,
    name: plan.name,
    startDate: plan.startDate,
    endDate: plan.endDate,
    createdAt: plan.createdAt,
    isFavorite: plan.isFavorite,
    coverPath: plan.coverPath ?? null,
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
    isFavorite: trip.is_favorite ?? false,
    travelContext: parseTravelContext(trip.travel_context) ?? undefined,
    coverPath: trip.cover_path ?? null,
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

/** Set when Supabase has no shopping_items table yet: the list then stays on this device. */
let shoppingTableMissing = false;

type DbWriteError = { code?: string; message?: string } | null;

/** One shopping list change in Supabase; the same code serves live writes and the offline replay. */
async function writeShoppingChange(
  operation: OfflineMutationQueueEntry["operation"],
  payload: Record<string, unknown>,
  idMap: Map<string, string>,
): Promise<DbWriteError> {
  if (operation === "create") {
    const tripId = String(payload.tripId);
    const items = (payload.items as ShoppingItem[]) ?? [];
    const rows = items.map((item) => shoppingItemToDb(item, idMap.get(tripId) ?? tripId));
    // Upsert: replaying a create that already reached the server must not fail.
    const { error } = await supabase.from(SHOPPING_TABLE).upsert(rows);
    return error;
  }
  const itemId = String(payload.itemId);
  if (operation === "update") {
    const { error } = await supabase.from(SHOPPING_TABLE).update(shoppingPatchToDb(payload.patch as Partial<ShoppingItem>)).eq("id", itemId);
    return error;
  }
  const { error } = await supabase.from(SHOPPING_TABLE).delete().eq("id", itemId);
  return error;
}

function sortActivities(activities: Activity[]) {
  return [...activities].sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
    return left.time.localeCompare(right.time);
  });
}

function buildTripSummaryFromDb(
  trip: TripDb & {
    trip_days?: { count: number }[];
    activities?: { count: number }[];
  }
): TripSummary {
  return {
    id: String(trip.id),
    name: String(trip.name),
    ...(trip.user_id ? { userId: String(trip.user_id) } : {}),
    startDate: trip.start_date ?? undefined,
    endDate: trip.end_date ?? undefined,
    createdAt: trip.created_at ?? undefined,
    isFavorite: trip.is_favorite ?? false,
    coverPath: trip.cover_path ?? null,
    dayCount: Number(trip.trip_days?.[0]?.count ?? 0),
    activityCount: Number(trip.activities?.[0]?.count ?? 0),
  };
}

function sortTripSummariesForUi(trips: TripSummary[]) {
  const selection = resolveTripSelection({
    current_date: getCurrentDateString(),
    trips: trips
      .filter((trip) => Boolean(trip.startDate && trip.endDate))
      .map((trip) => ({
        id: trip.id,
        name: trip.name,
        start_date: trip.startDate as string,
        end_date: trip.endDate as string,
        is_favorite: Boolean(trip.isFavorite),
        created_at: trip.createdAt ?? "",
      })),
  });

  const orderedIds = [
    ...selection.groups.active.map((trip) => trip.id),
    ...selection.groups.upcoming.map((trip) => trip.id),
    ...selection.groups.past.map((trip) => trip.id),
  ];
  const orderedIdSet = new Set(orderedIds);
  const orderedTrips = orderedIds
    .map((tripId) => trips.find((trip) => trip.id === tripId))
    .filter((trip): trip is TripSummary => Boolean(trip));
  const unsortedTrips = trips.filter((trip) => !orderedIdSet.has(trip.id));

  return [...orderedTrips, ...unsortedTrips];
}

function buildFavoriteValue(tripId: string, nextFavorite: boolean, candidateTripId: string) {
  return nextFavorite ? candidateTripId === tripId : false;
}

function applyFavoriteSummaryState(trips: TripSummary[], tripId: string, nextFavorite: boolean) {
  return sortTripSummariesForUi(
    trips.map((trip) => ({
      ...trip,
      isFavorite: buildFavoriteValue(tripId, nextFavorite, trip.id),
    }))
  );
}

function applyFavoritePlanState(plan: TripPlan | null, tripId: string, nextFavorite: boolean) {
  if (!plan) return null;

  return {
    ...plan,
    isFavorite: buildFavoriteValue(tripId, nextFavorite, plan.id),
  };
}

function getCurrentUserId() {
  return useAuthStore.getState().user?.id ?? null;
}

/** The travel context a new trip is saved with: the given one, carrying a currency. */
function newTripContext(context?: TravelContext) {
  return withTripCurrency(context, resolvePreferredCurrency(useAuthStore.getState().user));
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
        trips: sortTripSummariesForUi(
          state.trips.some((trip) => trip.id === activeTrip.id)
            ? state.trips.map((trip) => (trip.id === activeTrip.id ? buildTripSummaryFromPlan(activeTrip) : trip))
            : [buildTripSummaryFromPlan(activeTrip), ...state.trips]
        ),
      }));
    }
    await persistCacheFromState();
  };

  /** Who may change the active trip's cover; the server (set_trip_cover + storage policies) decides anyway. */
  const guardTripCover = (): { trip: TripPlan } | { error: TripCoverError } => {
    const trip = get().activeTrip;
    if (!trip) return { error: "forbidden" };
    // A draft has no row yet, so there is no trip folder to upload into.
    if (get().activeTripIsDraft) return { error: "draft" };
    if (!canEditTripCover(trip, getCurrentUserId())) return { error: "forbidden" };
    return { trip };
  };

  /** Best effort: an object left behind only costs storage, never breaks the trip. */
  const removeCoverObject = async (path: string) => {
    try {
      await supabase.storage.from(TRIP_COVERS_BUCKET).remove([path]);
    } catch (error) {
      console.error("Plania: trip cover cleanup error", error);
    }
  };

  /**
   * Sets trips.cover_path through set_trip_cover (editors cannot update the trips row
   * directly) and returns the path it replaced.
   */
  const pointTripAtCover = async (tripId: string, path: string | null): Promise<{ previous: string | null } | { error: TripCoverError }> => {
    try {
      const { data, error } = await supabase.rpc("set_trip_cover", { p_trip_id: tripId, p_cover_path: path });
      if (!error) return { previous: typeof data === "string" ? data : null };
      // Function or column missing: the migration has not been applied yet.
      const missing = ["PGRST202", "42883", "42703"].includes(String(error.code ?? "")) || /set_trip_cover|cover_path/.test(error.message ?? "");
      if (missing) return { error: "unavailable" };
      return { error: error.code === "42501" ? "forbidden" : "upload" };
    } catch {
      return { error: "upload" };
    }
  };

  const applyCoverPath = async (tripId: string, coverPath: string | null) => {
    await writeState((state) => ({
      activeTrip: state.activeTrip?.id === tripId ? { ...state.activeTrip, coverPath } : state.activeTrip,
      trips: state.trips.map((trip) => (trip.id === tripId ? { ...trip, coverPath } : trip)),
    }));
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

  /**
   * Mirrors a shopping list change in Supabase (or the offline queue). The sample trip stays
   * on this device, and so does everything while the shopping_items migration is missing.
   */
  const syncShopping = async (operation: OfflineMutationQueueEntry["operation"], payload: Record<string, unknown>) => {
    if (get().activeTripIsDraft || shoppingTableMissing) return;
    if (!isOnline()) {
      await enqueueMutation(operation, "shopping_item", payload);
      return;
    }
    const error = await writeShoppingChange(operation, payload, new Map());
    // A missing table only means the migration is pending: the change stays on this device.
    if (error && !isMissingShoppingTable(error)) set({ error: error.message ?? "Shopping list sync failed" });
  };

  /**
   * Mirrors a packing change in Supabase (or the offline queue), like the shopping list: the
   * sample trip and trips loaded while the packing_items migration is missing stay on this device.
   */
  const syncPacking = async (operation: OfflineMutationQueueEntry["operation"], payload: Record<string, unknown>) => {
    if (get().activeTripIsDraft || !get().activeTrip?.packing?.remote) return;
    if (!isOnline()) {
      await enqueueMutation(operation, "packing_item", payload);
      return;
    }
    const error = await writePackingChange(supabase as never, operation, payload, new Map());
    if (error && !isMissingPackingTable(error)) set({ error: error.message ?? "Packing list sync failed" });
  };

  const writePackingItems = (update: (items: PackingRecord[]) => PackingRecord[]) =>
    writeState((current) => ({
      activeTrip: current.activeTrip?.packing
        ? { ...current.activeTrip, packing: { ...current.activeTrip.packing, items: update(current.activeTrip.packing.items) } }
        : current.activeTrip,
    }));

  const patchPackingItem = async (itemId: string, patch: PackingPatch) => {
    if (!get().activeTrip?.packing?.items.some((item) => item.id === itemId)) return;
    await writePackingItems((items) => items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
    await syncPacking("update", { itemId, patch });
  };

  // The day that is today where the trip happens (its time zone, else the device's), not in UTC.
  // An undated trip has no today: its day dates are placeholders.
  const findTripToday = (plan: TripPlan) => {
    if (isTripUndated(plan)) return undefined;
    const today = getCurrentTripDateTime(new Date(), tripTimeZone(plan, Intl.DateTimeFormat().resolvedOptions().timeZone)).date;
    return plan.days.find((day) => day.date === today);
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

    // A requested trip (a URL) that is not cached falls back to the latest cached one, like online.
    const requestedTripId = tripId && cache.tripPlans[tripId] ? tripId : undefined;
    const resolvedTripId = requestedTripId ?? cache.latestTripId ?? cache.trips[0]?.id ?? null;
    const cachedTrip = resolvedTripId && cache.tripPlans[resolvedTripId]
      ? normalizeTripPlan(cache.tripPlans[resolvedTripId])
      : null;
    const currentActiveDayId = get().activeDayId;
    const todayDay = cachedTrip ? findTripToday(cachedTrip) : undefined;

    const nextActiveDayId = cachedTrip?.days.some((day) => day.id === currentActiveDayId)
      ? currentActiveDayId
      : todayDay?.id ?? cachedTrip?.days[0]?.id ?? "";

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
    } else if (userId) {
      tripQuery = tripQuery.eq("user_id", userId);
    }

    const { data: ownTrips, error } = await tripQuery;
    if (error) throw error;
    let trips = ownTrips;
    if (!tripId && userId && (!trips || trips.length === 0)) {
      // An account with no trips of its own opens the ones shared with it. Only trip_shares
      // counts: RLS would also let it read trips that merely have an open share link.
      const { data: shares, error: sharesError } = await supabase.from("trip_shares").select("trip_id").eq("shared_with", userId);
      if (sharesError) throw sharesError;
      const sharedIds = (shares ?? []).map((share) => String((share as { trip_id: string }).trip_id));
      if (sharedIds.length > 0) {
        const { data: sharedTrips, error: sharedError } = await supabase.from("trips").select("*").in("id", sharedIds);
        if (sharedError) throw sharedError;
        trips = sharedTrips;
      }
    }

      if (!trips || trips.length === 0) {
      // A trip asked for by id (a URL) that is gone or not shared opens the one the selection would pick.
      if (tripId) return fetchFreshTrip();
      set({ activeTrip: null, activeDayId: "", loading: false, hasFetched: true });
      return;
    }

    const availableTrips = (trips ?? []) as TripDb[];
    const selectedTripId = tripId ?? resolveTripSelection({
      current_date: getCurrentDateString(),
      trips: availableTrips
        .filter((trip) => Boolean(trip.start_date && trip.end_date))
        .map((trip) => ({
          id: String(trip.id),
          name: String(trip.name),
          start_date: String(trip.start_date),
          end_date: String(trip.end_date),
          is_favorite: Boolean(trip.is_favorite),
          created_at: trip.created_at ?? "",
        })),
    }).selected_trip_id;

    const trip = availableTrips.find((item) => item.id === selectedTripId) ?? availableTrips[0];
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
    const packing = await loadTripPacking({
      client: supabase as never,
      tripId: baseTripPlan.id,
      userId,
      tripOwnerId: trip.user_id,
      cached: cachedTrip?.packing,
    });
    const shopping = await loadShoppingItems({
      client: supabase as never,
      tripId: baseTripPlan.id,
      cachedItems: cachedTrip?.shoppingItems ?? [],
      // Only the owner uploads the items that lived on this device before the sync existed.
      canUpload: Boolean(userId) && trip.user_id === userId,
    });
    shoppingTableMissing = !shopping.remote;
    const tripPlan: TripPlan = normalizeTripPlan({
      ...baseTripPlan,
      shoppingItems: shopping.items,
      ignoredShoppingSuggestionKeys: cachedTrip?.ignoredShoppingSuggestionKeys ?? [],
      packing,
    });

    set((state) => {
      const nextTrips = sortTripSummariesForUi(
        state.trips.some((summary) => summary.id === tripPlan.id)
          ? state.trips.map((summary) => (summary.id === tripPlan.id ? buildTripSummaryFromPlan(tripPlan) : summary))
          : [buildTripSummaryFromPlan(tripPlan), ...state.trips]
      );
      const todayDay = findTripToday(tripPlan);

      const nextActiveDayId = tripPlan.days.some((day) => day.id === state.activeDayId)
        ? state.activeDayId
        : todayDay?.id ?? tripPlan.days[0]?.id ?? "";

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
          ...(payload.travelContext ? { travel_context: payload.travelContext } : {}),
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

    if (entry.target === "trip_favorite" && entry.operation === "update") {
      const tripId = String(resolveMappedId(payload.tripId, idMap));
      const nextFavorite = Boolean(payload.isFavorite);

      if (nextFavorite) {
        const { error: clearError } = await supabase
          .from("trips")
          .update({ is_favorite: false })
          .eq("user_id", entry.userId)
          .eq("is_favorite", true);
        if (clearError) throw clearError;
      }

      const { error } = await supabase
        .from("trips")
        .update({ is_favorite: nextFavorite })
        .eq("id", tripId)
        .eq("user_id", entry.userId);
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

    if (entry.target === "packing_item") {
      const error = await writePackingChange(supabase as never, entry.operation, payload, idMap);
      if (error && !isMissingPackingTable(error)) throw error;
      return;
    }

    if (entry.target === "shopping_item") {
      const error = await writeShoppingChange(entry.operation, payload, idMap);
      if (error && !isMissingShoppingTable(error)) throw error;
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
    activeTripIsDraft: false,
    trips: [],
    sharedTrips: [],
    tripShares: [],
    sharesLoading: false,
    activeDayId: "",
    dayScrollY: {},
    loading: false,
    isImporting: false,
    hasFetched: false,
    error: null,

    fetchSharedTrips: async () => {
      const userId = getCurrentUserId();
      if (!userId || !isOnline()) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;
        
        const res = await fetch("/api/trips/shared", { headers });
        if (res.ok) {
          const data = await res.json();
          set({ sharedTrips: data.trips ?? [] });
        }
      } catch (error) {
        console.error("Plania: fetchSharedTrips error", error);
      }
    },

    shareTrip: async (tripId, email, role = "viewer") => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(`/api/trips/${tripId}/share`, {
          method: "POST",
          headers,
          body: JSON.stringify({ email, role }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error ?? "Error al compartir" };
        return {};
      } catch {
        return { error: "Error de conexión" };
      }
    },

    fetchTripShares: async (tripId) => {
      set({ sharesLoading: true });
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;

        const res = await fetch(`/api/trips/${tripId}/shares`, { headers });
        if (res.ok) {
          const data = await res.json();
          set({ tripShares: data.shares ?? [], sharesLoading: false });
        } else {
          set({ sharesLoading: false });
        }
      } catch (error) {
        console.error("Plania: fetchTripShares error", error);
        set({ sharesLoading: false });
      }
    },

    updateTripShareRole: async (tripId, userId, role) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        const res = await fetch(`/api/trips/${tripId}/shares/${userId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ role }),
        });
        if (res.ok) {
          set((state) => ({
            tripShares: state.tripShares.map((s) =>
              s.userId === userId ? { ...s, role } : s
            ),
          }));
        }
      } catch (error) {
        console.error("Plania: updateTripShareRole error", error);
      }
    },

    revokeTripShare: async (tripId, userId) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;

        const res = await fetch(`/api/trips/${tripId}/shares/${userId}`, {
          method: "DELETE",
          headers,
        });
        if (res.ok) {
          set((state) => ({
            tripShares: state.tripShares.filter((s) => s.userId !== userId),
          }));
        }
      } catch (error) {
        console.error("Plania: revokeTripShare error", error);
      }
    },

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
          .select("*, trip_days(count), activities(count)");
        if (error) throw error;

        const trips = sortTripSummariesForUi(
          (data ?? []).map((trip) =>
            buildTripSummaryFromDb(trip as TripDb & { trip_days?: { count: number }[]; activities?: { count: number }[] })
          )
        );

        set({ trips, error: null, hasFetched: true, loading: false });
        await persistCacheFromState();
      } catch (error) {
        console.error("Plania: fetchAllTrips error", error);
        await hydrateFromCache();
      }
    },

    fetchActiveTrip: async (tripId, skipLoading = false) => {
      const resolvedTripId = tripId ?? get().activeTrip?.id;

      // Draft (unsaved template) trips are not in the database; skip fetching.
      if (get().activeTripIsDraft && resolvedTripId === get().activeTrip?.id) {
        return;
      }

      if (!skipLoading) set({ loading: true, error: null, hasFetched: false });
      else set({ error: null });

      if (!isOnline()) {
        await hydrateFromCache(resolvedTripId);
        return;
      }

      try {
        await fetchFreshTrip(resolvedTripId);
      } catch (error) {
        console.error("Plania: fetchActiveTrip error", error);
        await hydrateFromCache(resolvedTripId);
      }
    },

    createTrip: async (name, startDate, endDate) => {
      const userId = getCurrentUserId();
      if (!userId) return;

      const finalStartDate = startDate || new Date().toISOString().split("T")[0];
      const finalEndDate = endDate || finalStartDate;
      const travelContext = newTripContext();

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
          isFavorite: false,
          travelContext,
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
          travelContext,
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
          travel_context: travelContext,
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

    cloneTrip: async (template, name, startDate) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !session.user?.id) {
        set({ error: "Tu sesión no está activa. Inicia sesión de nuevo (y confirma tu email si es necesario)." });
        return;
      }
      const userId = session.user.id;

      const finalName = name?.trim() || template.name;
      const finalStartDate = startDate || template.startDate || new Date().toISOString().split("T")[0];
      // Compute end date based on template duration
      const start = new Date(finalStartDate);
      const end = new Date(start);
      end.setDate(end.getDate() + Math.max(0, template.days.length - 1));
      const finalEndDate = end.toISOString().split("T")[0];

      if (!isOnline()) {
        // Offline: create a local trip and queue mutations (simplified: treat as createTrip)
        await get().createTrip(finalName, finalStartDate, finalEndDate);
        return;
      }

      set({ loading: true });
      const { data: newTrip, error } = await supabase
        .from("trips")
        .insert({
          name: finalName,
          user_id: userId,
          start_date: finalStartDate,
          end_date: finalEndDate,
          travel_context: newTripContext(template.travelContext?.currency ? { version: 1, currency: template.travelContext.currency } : undefined),
        })
        .select()
        .single();

      if (error || !newTrip) {
        set({ loading: false, error: error?.message ?? "Failed to clone trip" });
        return;
      }

      const newTripId = String(newTrip.id);

      // Create days (let DB generate ids), then map old day id -> new day id
      const dayIdMap = new Map<string, string>();
      if (template.days.length > 0) {
        const daysToCreate = template.days.map((day) => ({
          trip_id: newTripId,
          user_id: userId,
          date: day.date,
          city: day.city,
          label: day.label,
        }));
        const { data: createdDays, error: daysError } = await supabase
          .from("trip_days")
          .insert(daysToCreate)
          .select("id, date, city, label");
        if (daysError) {
          set({ loading: false, error: daysError.message });
          return;
        }
        // Map by index (template.days order matches insert order)
        template.days.forEach((day, i) => {
          if (createdDays && createdDays[i]) {
            dayIdMap.set(day.id, String(createdDays[i].id));
          }
        });
      }

      // Create activities (let DB generate ids)
      const activitiesToCreate: Array<Record<string, unknown>> = [];
      for (const day of template.days) {
        const newDayId = dayIdMap.get(day.id);
        if (!newDayId) continue;
        for (const act of day.activities) {
          activitiesToCreate.push({
            trip_id: newTripId,
            user_id: userId,
            day_id: newDayId,
            title: act.title,
            time: act.time,
            duration_min: act.durationMin,
            notes: act.notes ?? null,
            location: act.location ?? null,
            maps_url: act.mapsUrl ?? null,
            reservation_url: act.reservationUrl ?? null,
            expected_cost: act.expectedCost ?? null,
            category: act.category,
            priority: act.priority,
            state: "pending",
            sort_order: act.sort_order,
          });
        }
      }

      if (activitiesToCreate.length > 0) {
        const { error: actsError } = await supabase.from("activities").insert(activitiesToCreate);
        if (actsError) {
          set({ loading: false, error: actsError.message });
          return;
        }
      }

      await get().fetchActiveTrip(newTripId, true);
    },

    loadTemplate: (template) => {
      const userId = getCurrentUserId();
      const plan: TripPlan = {
        ...template,
        id: template.id,
        userId: userId ?? null,
      };
      const firstDayId = plan.days[0]?.id ?? "";
      set({
        activeTrip: plan,
        activeTripIsDraft: true,
        activeDayId: firstDayId,
        loading: false,
        error: null,
        hasFetched: true,
      });
    },

    saveDraft: async () => {
      const activeTrip = get().activeTrip;
      if (!activeTrip || !get().activeTripIsDraft) {
        return { error: "No hay borrador para guardar." };
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !session.user?.id) {
        return { error: "Tu sesión no está activa. Inicia sesión de nuevo (y confirma tu email si es necesario)." };
      }
      const userId = session.user.id;

      set({ loading: true });
      // An undated trip (planned by number of days) is saved without a start or end.
      const undated = isTripUndated(activeTrip);
      const finalStartDate = undated ? null : activeTrip.startDate || new Date().toISOString().split("T")[0];
      const finalEndDate = undated ? null : activeTrip.endDate || finalStartDate;

      const { data: newTrip, error } = await supabase
        .from("trips")
        .insert({
          name: activeTrip.name,
          user_id: userId,
          start_date: finalStartDate,
          end_date: finalEndDate,
          // The style chosen while planning (travelers, preferences) stays with the saved trip,
          // which also takes the preferred currency unless the draft already has one.
          travel_context: newTripContext(activeTrip.travelContext),
        })
        .select()
        .single();

      if (error || !newTrip) {
        set({ loading: false, error: error?.message ?? "No se pudo guardar." });
        return { error: error?.message ?? "No se pudo guardar." };
      }

      const newTripId = String(newTrip.id);

      // Create days
      const dayIdMap = new Map<string, string>();
      if (activeTrip.days.length > 0) {
        const daysToCreate = activeTrip.days.map((day) => ({
          trip_id: newTripId,
          user_id: userId,
          date: day.date,
          city: day.city,
          label: day.label,
        }));
        const { data: createdDays, error: daysError } = await supabase
          .from("trip_days")
          .insert(daysToCreate)
          .select("id");
        if (daysError) {
          set({ loading: false, error: daysError.message });
          return { error: daysError.message };
        }
        activeTrip.days.forEach((day, i) => {
          if (createdDays && createdDays[i]) {
            dayIdMap.set(day.id, String(createdDays[i].id));
          }
        });
      }

      // Create activities
      const activitiesToCreate: Array<Record<string, unknown>> = [];
      for (const day of activeTrip.days) {
        const newDayId = dayIdMap.get(day.id);
        if (!newDayId) continue;
        for (const act of day.activities) {
          activitiesToCreate.push({
            trip_id: newTripId,
            user_id: userId,
            day_id: newDayId,
            title: act.title,
            time: act.time,
            duration_min: act.durationMin,
            notes: act.notes ?? null,
            location: act.location ?? null,
            maps_url: act.mapsUrl ?? null,
            reservation_url: act.reservationUrl ?? null,
            expected_cost: act.expectedCost ?? null,
            category: act.category,
            priority: act.priority,
            state: act.state ?? "pending",
            sort_order: act.sort_order,
          });
        }
      }

      if (activitiesToCreate.length > 0) {
        const { error: actsError } = await supabase.from("activities").insert(activitiesToCreate);
        if (actsError) {
          set({ loading: false, error: actsError.message });
          return { error: actsError.message };
        }
      }

      // Reservations added on the sample trip come along too (best effort).
      if (activeTrip.criticalReservations.length > 0) {
        const { error: reservationsError } = await supabase.from("critical_reservations").insert(
          activeTrip.criticalReservations.map((reservation) => ({
            trip_id: newTripId,
            user_id: userId,
            title: reservation.title,
            booking_deadline: reservation.bookingDeadline,
            reservation_date: reservation.reservationDate,
            booking_link: reservation.bookingLink,
            urgency: reservation.urgency,
            status: reservation.status,
            price: reservation.price,
          })),
        );
        if (reservationsError) console.error("Reservations copy failed:", reservationsError);
      }

      // The shopping list started on the sample trip comes along (best effort: without the
      // shopping_items table it simply stays empty on the saved trip).
      if (activeTrip.shoppingItems.length > 0) {
        const { error: shoppingError } = await supabase.from(SHOPPING_TABLE).insert(
          activeTrip.shoppingItems.map((item) => shoppingItemToDb({ ...item, id: isUuid(item.id) ? item.id : crypto.randomUUID() }, newTripId)),
        );
        if (shoppingError && !isMissingShoppingTable(shoppingError)) console.error("Shopping list copy failed:", shoppingError);
      }

      set({ activeTripIsDraft: false });
      await get().fetchActiveTrip(newTripId, true);
      return {};
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

    setTripFavorite: async (tripId) => {
      const userId = getCurrentUserId();
      if (!userId) return;

      const selectedTrip = get().trips.find((trip) => trip.id === tripId);
      if (!selectedTrip) return;

      const nextFavorite = !selectedTrip.isFavorite;
      const previousTrips = get().trips;
      const previousActiveTrip = get().activeTrip;

      await writeState((state) => ({
        trips: applyFavoriteSummaryState(state.trips, tripId, nextFavorite),
        activeTrip: applyFavoritePlanState(state.activeTrip, tripId, nextFavorite),
        error: null,
      }));

      if (!isOnline()) {
        await enqueueMutation("update", "trip_favorite", { tripId, isFavorite: nextFavorite });
        return;
      }

      try {
        if (nextFavorite) {
          const { error: clearError } = await supabase
            .from("trips")
            .update({ is_favorite: false })
            .eq("user_id", userId)
            .eq("is_favorite", true);
          if (clearError) throw clearError;
        }

        const { error } = await supabase
          .from("trips")
          .update({ is_favorite: nextFavorite })
          .eq("id", tripId)
          .eq("user_id", userId);
        if (error) throw error;
      } catch (error) {
        set({
          trips: previousTrips,
          activeTrip: previousActiveTrip,
          error: error instanceof Error ? error.message : "Failed to update favorite trip",
        });
        await persistCacheFromState();
      }
    },

    saveTravelContext: async (travelContext) => {
      const activeTrip = get().activeTrip;
      const userId = getCurrentUserId();
      if (!activeTrip || !userId || activeTrip.userId !== userId) {
        return { error: "Only the trip owner can edit its travel context." };
      }
      if (!isOnline()) return { error: "Connect to the internet to save travel context." };

      const normalizedContext = travelContext ? parseTravelContext(travelContext) : null;
      if (travelContext && !normalizedContext) return { error: "Travel context contains invalid values." };

      let updateQuery = supabase
        .from("trips")
        .update({ travel_context: normalizedContext })
        .eq("id", activeTrip.id)
        .eq("user_id", userId);
      updateQuery = activeTrip.travelContext
        ? updateQuery.eq("travel_context", activeTrip.travelContext)
        : updateQuery.is("travel_context", null);

      const { data, error } = await updateQuery.select("id").maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { error: "conflict" };

      await writeState((state) => ({
        activeTrip: state.activeTrip?.id === activeTrip.id
          ? { ...state.activeTrip, travelContext: normalizedContext ?? undefined }
          : state.activeTrip,
      }));
      return {};
    },

    setTripDates: async (startDate) => {
      const activeTrip = get().activeTrip;
      const userId = getCurrentUserId();
      if (!activeTrip) return { error: "No trip to date." };
      const dates = consecutiveDates(startDate, activeTrip.days.length);
      const startOfTrip = dates[0] ?? startDate;
      const endOfTrip = dates.at(-1) ?? startDate;
      const travelContext = withoutUndatedFlag(activeTrip.travelContext);
      const dated = (plan: TripPlan): TripPlan => ({
        ...plan,
        startDate: startOfTrip,
        endDate: endOfTrip,
        travelContext: travelContext ?? undefined,
        days: plan.days.map((day, index) => ({ ...day, date: dates[index] ?? day.date })),
      });

      // A draft lives only on this device until it is saved.
      if (get().activeTripIsDraft) {
        set((state) => ({ activeTrip: state.activeTrip?.id === activeTrip.id ? dated(state.activeTrip) : state.activeTrip }));
        return {};
      }
      if (!userId || activeTrip.userId !== userId) return { error: "Only the trip owner can set its dates." };
      // Every day changes at once, so it is not queued for later like a single edit.
      if (!isOnline()) return { error: "offline" };

      // Days first, in order: the trip only stops being undated once they all have their date.
      const dayResults = await Promise.all(
        activeTrip.days.map((day, index) => supabase.from("trip_days").update({ date: dates[index] }).eq("id", day.id)),
      );
      const dayError = dayResults.find((result) => result.error)?.error;
      if (dayError) return { error: dayError.message };

      const { error } = await supabase
        .from("trips")
        .update({ start_date: startOfTrip, end_date: endOfTrip, travel_context: travelContext })
        .eq("id", activeTrip.id)
        .eq("user_id", userId);
      if (error) return { error: error.message };

      await writeState((state) => ({
        activeTrip: state.activeTrip?.id === activeTrip.id ? dated(state.activeTrip) : state.activeTrip,
      }));
      return {};
    },

    setTripCover: async (file) => {
      const guard = guardTripCover();
      if ("error" in guard) return guard;
      const invalid = validateTripCoverFile(file);
      if (invalid) return { error: invalid };
      if (!isOnline()) return { error: "offline" };

      const tripId = guard.trip.id;
      const path = tripCoverObjectPath(tripId, file.type);
      try {
        const { error: uploadError } = await supabase.storage
          .from(TRIP_COVERS_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
        if (uploadError) return { error: /bucket not found/i.test(uploadError.message ?? "") ? "unavailable" : "upload" };
      } catch {
        return { error: "upload" };
      }

      const result = await pointTripAtCover(tripId, path);
      if ("error" in result) {
        await removeCoverObject(path);
        return result;
      }
      if (result.previous && result.previous !== path) await removeCoverObject(result.previous);
      await applyCoverPath(tripId, path);
      return {};
    },

    removeTripCover: async () => {
      const guard = guardTripCover();
      if ("error" in guard) return guard;
      if (!isOnline()) return { error: "offline" };

      const tripId = guard.trip.id;
      const result = await pointTripAtCover(tripId, null);
      if ("error" in result) return result;
      if (result.previous) await removeCoverObject(result.previous);
      await applyCoverPath(tripId, null);
      return {};
    },

    switchTrip: async (tripId) => {
      await get().fetchActiveTrip(tripId, true);
    },

    clearData: () => {
      set({
        activeTrip: null,
        activeTripIsDraft: false,
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
      const previousState = get()
        .activeTrip?.days.find((day) => day.id === dayId)
        ?.activities.find((activity) => activity.id === activityId)?.state;

      const applyState = (nextState: ActivityState) =>
        writeState((current) => ({
          activeTrip: current.activeTrip
            ? {
                ...current.activeTrip,
                days: current.activeTrip.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        activities: day.activities.map((activity) =>
                          activity.id === activityId ? { ...activity, state: nextState } : activity
                        ),
                      }
                    : day
                ),
              }
            : null,
        }));

      await applyState(state);

      if (!isOnline()) {
        await enqueueMutation("update", "activity_state", { dayId, activityId, state });
        return true;
      }

      const { error } = await supabase.from("activities").update({ state }).eq("id", activityId);
      if (error) {
        // Roll back only this activity, without setting the global error that replaces the trip screen.
        console.warn("Failed to update activity state:", error.message);
        if (previousState) await applyState(previousState);
        return false;
      }
      return true;
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

    reorderActivitiesToOrder: async (dayId, orderedActivityIds) => {
      const day = get().activeTrip?.days.find((item) => item.id === dayId);
      if (!day || orderedActivityIds.length !== day.activities.length) return;

      const activityMap = new Map(day.activities.map((activity) => [activity.id, activity]));
      if (
        new Set(orderedActivityIds).size !== day.activities.length ||
        orderedActivityIds.some((activityId) => !activityMap.has(activityId))
      ) return;

      const orderedActivities = orderedActivityIds.map((activityId, index) => ({
        ...activityMap.get(activityId)!,
        sort_order: index,
      }));

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
          orderedActivityIds,
        });
        return;
      }

      const { error } = await supabase
        .from("activities")
        .upsert(orderedActivities.map((activity) => ({ id: activity.id, sort_order: activity.sort_order })));
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

      // The sample trip lives on this device until it is saved (its id is not a database id).
      if (get().activeTripIsDraft) return;

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

    addActivitiesBatch: async (activities) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return { ok: false, error: "No active trip" };
      if (!isOnline()) return { ok: false, error: "offline" };
      if (activities.length === 0) return { ok: true, ids: [] };

      const created: Activity[] = activities.map((activity) => ({
        ...activity,
        id: crypto.randomUUID(),
        tripId: activeTrip.id,
        userId: String(activeTrip.userId ?? ""),
      }));
      const createdIds = new Set(created.map((a) => a.id));

      await writeState((state) => ({
        activeTrip: state.activeTrip
          ? {
              ...state.activeTrip,
              days: state.activeTrip.days.map((day) => {
                const additions = created.filter((a) => a.dayId === day.id);
                return additions.length ? { ...day, activities: sortActivities([...day.activities, ...additions]) } : day;
              }),
            }
          : null,
      }));

      const { error } = await supabase.from("activities").insert(
        withUniformOrigin(created.map((activity) => ({
          ...mapActivityToDb(activity),
          id: activity.id,
          trip_id: activeTrip.id,
          user_id: activeTrip.userId,
        })))
      );

      if (error) {
        // All-or-nothing: a failed batch never leaves a partial itinerary behind.
        await writeState((state) => ({
          activeTrip: state.activeTrip
            ? {
                ...state.activeTrip,
                days: state.activeTrip.days.map((day) => ({
                  ...day,
                  activities: day.activities.filter((a) => !createdIds.has(a.id)),
                })),
              }
            : null,
        }));
        return { ok: false, error: error.message };
      }

      await get().fetchActiveTrip(activeTrip.id, true);
      return { ok: true, ids: created.map((a) => a.id) };
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

      // The sample trip lives on this device until it is saved (its id is not a database id).
      if (get().activeTripIsDraft) return;

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

      // The sample trip lives on this device until it is saved (its id is not a database id).
      if (get().activeTripIsDraft) return;

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

      // The sample trip lives on this device until it is saved (its id is not a database id).
      if (get().activeTripIsDraft) return;

      if (!isOnline()) {
        await enqueueMutation("delete", "reservation", { reservationId });
        return;
      }

      const { error } = await supabase.from("critical_reservations").delete().eq("id", reservationId);
      if (error) set({ error: error.message });
    },

    addShoppingItems: async (items) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return;
      const existingKeys = new Set(activeTrip.shoppingItems.map((item) => item.name.trim().toLowerCase()));
      const nextItems = items
        .filter((item) => !existingKeys.has(item.name.trim().toLowerCase()))
        .map((item) => ({
          ...item,
          // A real UUID from the start: it is the row id in Supabase, online or replayed later.
          id: item.id && isUuid(item.id) ? item.id : crypto.randomUUID(),
          status: item.status || "pending",
        }));
      if (nextItems.length === 0) return;

      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? { ...current.activeTrip, shoppingItems: [...current.activeTrip.shoppingItems, ...nextItems] }
          : null,
      }));
      await syncShopping("create", { tripId: activeTrip.id, items: nextItems });
    },

    toggleShoppingItemStatus: async (itemId) => {
      const item = get().activeTrip?.shoppingItems.find((entry) => entry.id === itemId);
      if (!item) return;
      const status = item.status === "purchased" ? "pending" : "purchased";
      await writeState((current) => ({
        activeTrip: current.activeTrip
          ? {
              ...current.activeTrip,
              shoppingItems: current.activeTrip.shoppingItems.map((entry) => (entry.id === itemId ? { ...entry, status } : entry)),
            }
          : null,
      }));
      await syncShopping("update", { itemId, patch: { status } });
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
      await syncShopping("update", { itemId, patch });
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
      await syncShopping("delete", { itemId });
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

    replacePackingList: async (scope, list) => {
      const activeTrip = get().activeTrip;
      const ownerId = getCurrentUserId();
      if (!activeTrip?.packing || !ownerId) return;
      const previousIds = recordsOf(activeTrip.packing.items, scope, ownerId).map((item) => item.id);
      const nextItems = packingListToRecords(list, scope, ownerId);
      await writePackingItems((items) => [...items.filter((item) => !previousIds.includes(item.id)), ...nextItems]);
      savePackingMeta(activeTrip.id, scope, { generatedAt: list.generatedAt, weatherSummaries: list.weatherSummaries });
      if (previousIds.length > 0) await syncPacking("delete", { itemIds: previousIds });
      await syncPacking("create", { tripId: activeTrip.id, items: nextItems });
    },

    addPackingItem: async (scope, name) => {
      const activeTrip = get().activeTrip;
      const ownerId = getCurrentUserId();
      const trimmed = name.trim();
      if (!activeTrip?.packing || !ownerId || !trimmed) return;
      const current = recordsOf(activeTrip.packing.items, scope, ownerId);
      const firstCategory = current[0]?.category;
      if (firstCategory === undefined) return;
      const item: PackingRecord = {
        id: crypto.randomUUID(),
        name: trimmed,
        quantity: 1,
        reason: "Manually added",
        status: "pending",
        scope,
        category: firstCategory,
        ownerId: scope === "personal" ? ownerId : null,
        assignedTo: null,
        sortOrder: Math.max(...current.map((entry) => entry.sortOrder)) + 1,
      };
      await writePackingItems((items) => [...items, item]);
      await syncPacking("create", { tripId: activeTrip.id, items: [item] });
    },

    togglePackingItem: async (itemId) => {
      const item = get().activeTrip?.packing?.items.find((entry) => entry.id === itemId);
      if (!item) return;
      await patchPackingItem(itemId, { status: item.status === "packed" ? "pending" : "packed" });
    },

    assignPackingItem: async (itemId, userId) => {
      const item = get().activeTrip?.packing?.items.find((entry) => entry.id === itemId);
      if (!item || item.scope !== "shared") return;
      await patchPackingItem(itemId, { assignedTo: userId });
    },

    removePackingItem: async (itemId) => {
      if (!get().activeTrip?.packing?.items.some((item) => item.id === itemId)) return;
      await writePackingItems((items) => items.filter((item) => item.id !== itemId));
      await syncPacking("delete", { itemIds: [itemId] });
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

    applyDayPlan: async (ops) => {
      const activeTrip = get().activeTrip;
      if (!activeTrip) return { ok: false, error: "No active trip" };
      if (!isOnline()) return { ok: false, error: "offline" };

      const originals = new Map(
        activeTrip.days.flatMap((day) => day.activities.map((activity) => [activity.id, { activity, dayId: day.id }] as const))
      );
      const applied: string[] = [];
      const restore = async () => {
        for (const activityId of applied) {
          const original = originals.get(activityId);
          if (!original) continue;
          await supabase.from("activities").update(mapActivityToDb({
            dayId: original.dayId,
            time: original.activity.time,
            durationMin: original.activity.durationMin,
            sort_order: original.activity.sort_order,
          })).eq("id", activityId);
        }
      };

      for (const update of ops.updates) {
        // Only these fields: notes, links, files and every other detail stay as they are.
        const { error } = await supabase.from("activities").update(mapActivityToDb(update.patch)).eq("id", update.activityId);
        if (error) {
          await restore();
          await get().fetchActiveTrip(activeTrip.id, true);
          return { ok: false, error: error.message };
        }
        applied.push(update.activityId);
      }

      if (ops.additions.length > 0) {
        const result = await get().addActivitiesBatch(ops.additions);
        if (!result.ok) {
          await restore();
          await get().fetchActiveTrip(activeTrip.id, true);
          return { ok: false, error: result.error };
        }
      }

      await get().fetchActiveTrip(activeTrip.id, true);
      return { ok: true };
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
      const nextActiveTripId = activeTripId ? (idMap.get(activeTripId) ?? activeTripId) : undefined;

      if (nextActiveTripId) {
        await get().fetchActiveTrip(nextActiveTripId, true);
      } else {
        await get().fetchAllTrips();
        await get().fetchActiveTrip(undefined, true);
      }
    },
  };
});
