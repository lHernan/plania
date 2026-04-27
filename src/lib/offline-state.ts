"use client";

import type { Session, User } from "@supabase/supabase-js";
import type { TripPlan, TripSummary } from "@/lib/types";

const DB_NAME = "plania-offline";
const DB_VERSION = 1;
const KV_STORE = "kv";
const QUEUE_STORE = "queue";

const AUTH_CACHE_KEY = "auth-cache";

export type OfflineMutationOperation = "create" | "update" | "delete";

export type OfflineMutationTarget =
  | "trip"
  | "trip_day"
  | "activity"
  | "activity_state"
  | "activity_reorder"
  | "reservation"
  | "activity_file"
  | "file_focus_area";

export type OfflineAuthCache = {
  user: User | null;
  session: Session | null;
  cachedAt: number;
};

export type OfflineTripCache = {
  trips: TripSummary[];
  tripPlans: Record<string, TripPlan>;
  latestTripId: string | null;
  cachedAt: number;
};

export type OfflineMutationQueueEntry = {
  id: string;
  operation: OfflineMutationOperation;
  target: OfflineMutationTarget;
  payload: Record<string, unknown>;
  timestamp: number;
  userId: string;
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
};

type KvRecord = {
  key: string;
  value: unknown;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(KV_STORE)) {
        database.createObjectStore(KV_STORE, { keyPath: "key" });
      }

      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => unknown
) {
  return openDb().then((database) => new Promise<T | undefined>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = executor(store) as IDBRequest<T> | void;

    if (request) {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    } else {
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error);
    }
  }));
}

function tripCacheKey(userId: string) {
  return `trip-cache:${userId}`;
}

export function createOfflineId(prefix: string) {
  return `offline-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isOfflineId(value?: string | null) {
  return Boolean(value?.startsWith("offline-"));
}

export function getRetryDelayMs(attempts: number) {
  const delay = 2 ** attempts * 1_000;
  return Math.min(delay, 60_000);
}

export async function saveOfflineAuthCache(cache: OfflineAuthCache) {
  await withStore<KvRecord>(KV_STORE, "readwrite", (store) =>
    store.put({ key: AUTH_CACHE_KEY, value: cache })
  );
}

export async function loadOfflineAuthCache() {
  const record = await withStore<KvRecord>(KV_STORE, "readonly", (store) =>
    store.get(AUTH_CACHE_KEY)
  );
  return (record?.value as OfflineAuthCache | undefined) ?? null;
}

export async function saveOfflineTripCache(userId: string, cache: OfflineTripCache) {
  await withStore<KvRecord>(KV_STORE, "readwrite", (store) =>
    store.put({ key: tripCacheKey(userId), value: cache })
  );
}

export async function loadOfflineTripCache(userId: string) {
  const record = await withStore<KvRecord>(KV_STORE, "readonly", (store) =>
    store.get(tripCacheKey(userId))
  );
  return (record?.value as OfflineTripCache | undefined) ?? null;
}

export async function enqueueOfflineMutation(entry: OfflineMutationQueueEntry) {
  await withStore<OfflineMutationQueueEntry>(QUEUE_STORE, "readwrite", (store) =>
    store.put(entry)
  );
}

export async function updateOfflineMutation(entry: OfflineMutationQueueEntry) {
  await withStore<OfflineMutationQueueEntry>(QUEUE_STORE, "readwrite", (store) =>
    store.put(entry)
  );
}

export async function deleteOfflineMutation(id: string) {
  await withStore<void>(QUEUE_STORE, "readwrite", (store) => {
    store.delete(id);
  });
}

export async function listOfflineMutations() {
  const entries = await withStore<OfflineMutationQueueEntry[]>(QUEUE_STORE, "readonly", (store) =>
    store.getAll()
  );
  return (entries ?? []).sort((left, right) => left.timestamp - right.timestamp);
}

export async function countPendingOfflineMutations() {
  const entries = await listOfflineMutations();
  return entries.length;
}
