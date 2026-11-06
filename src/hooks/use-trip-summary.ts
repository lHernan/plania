"use client";

import { useEffect, useState } from "react";
import { isAiQuotaExceeded } from "@/lib/ai/quota-client";
import { authHeaders } from "@/lib/auth-headers";

export type TripSummaryStatus = "loading" | "done" | "offline" | "error" | "quota_exceeded";
export type TripSummaryState = { status: TripSummaryStatus; summary: string };

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Asks the summary route for the trip; the route reads only what the signed-in user can see. */
export async function requestTripSummary(tripId: string, lang: string): Promise<TripSummaryState> {
  if (isOffline()) return { status: "offline", summary: "" };
  try {
    const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/summary`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ lang }),
    });
    if (await isAiQuotaExceeded(response)) return { status: "quota_exceeded", summary: "" };
    const body = (await response.json().catch(() => null)) as { summary?: unknown } | null;
    if (!response.ok || typeof body?.summary !== "string" || !body.summary) return { status: "error", summary: "" };
    return { status: "done", summary: body.summary };
  } catch {
    return { status: isOffline() ? "offline" : "error", summary: "" };
  }
}

/** "Resume mi viaje": generates on mount; `regenerate` asks again. */
export function useTripSummary(tripId: string, lang: string) {
  const [state, setState] = useState<TripSummaryState>({ status: "loading", summary: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void requestTripSummary(tripId, lang).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, lang, attempt]);

  const regenerate = () => {
    setState({ status: "loading", summary: "" });
    setAttempt((value) => value + 1);
  };

  return { ...state, regenerate };
}
