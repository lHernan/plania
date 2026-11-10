"use client";

import { useCallback, useEffect, useState } from "react";
import { loadExpenses, loadSettlements, type ExpenseError, type ExpensesClient } from "@/lib/expenses/sync";
import type { Expense, Settlement } from "@/lib/expenses/types";
import { supabase } from "@/lib/supabase";

export type TripExpensesData = { expenses: Expense[]; settlements: Settlement[]; error?: ExpenseError };

const client = supabase as unknown as ExpensesClient;

// One request per trip shared by the itinerary and the Expenses section; failures are retried.
const cache = new Map<string, Promise<TripExpensesData>>();
// Mounted hooks per trip, told to load again after a write or a realtime change.
const listeners = new Map<string, Set<() => void>>();

export function clearTripExpensesCache() {
  cache.clear();
}

/** Drops the trip's cached expenses and makes every mounted view load them again. */
export function refreshTripExpenses(tripId: string) {
  cache.delete(tripId);
  for (const listener of listeners.get(tripId) ?? []) listener();
}

async function fetchTripExpenses(tripId: string): Promise<TripExpensesData> {
  const [loaded, history] = await Promise.all([loadExpenses(client, tripId), loadSettlements(client, tripId)]);
  // A settlements failure alone leaves the history empty; a missing schema is unavailable.
  const error = loaded.error ?? (history.error === "unavailable" ? "unavailable" : undefined);
  return error ? { expenses: [], settlements: [], error } : { expenses: loaded.expenses, settlements: history.settlements };
}

function loadShared(tripId: string): Promise<TripExpensesData> {
  const cached = cache.get(tripId);
  if (cached) return cached;
  const request = fetchTripExpenses(tripId)
    .catch((): TripExpensesData => ({ expenses: [], settlements: [], error: "failed" }))
    .then((result) => {
      if (result.error && cache.get(tripId) === request) cache.delete(tripId);
      return result;
    });
  cache.set(tripId, request);
  return request;
}

/**
 * The trip's expenses and settlements, loaded only while `enabled`. A failed refresh keeps
 * what was already loaded (except a missing schema); `refresh` reloads every view of the trip.
 */
export function useTripExpenses(tripId: string, enabled = true): { data: TripExpensesData | null; loading: boolean; refresh: () => void } {
  const [state, setState] = useState<{ tripId: string; result: TripExpensesData } | null>(null);
  const [version, setVersion] = useState(0);
  const active = enabled && Boolean(tripId);

  useEffect(() => {
    if (!active) return;
    const bump = () => setVersion((value) => value + 1);
    const set = listeners.get(tripId) ?? new Set<() => void>();
    listeners.set(tripId, set);
    set.add(bump);
    return () => {
      set.delete(bump);
      if (set.size === 0) listeners.delete(tripId);
    };
  }, [tripId, active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadShared(tripId).then((result) => {
      if (cancelled) return;
      setState((current) => {
        const keep = result.error && result.error !== "unavailable" && current?.tripId === tripId && !current.result.error;
        return keep ? current : { tripId, result };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, active, version]);

  const refresh = useCallback(() => refreshTripExpenses(tripId), [tripId]);
  const data = state?.tripId === tripId ? state.result : null;
  return { data, loading: active && !data, refresh };
}
