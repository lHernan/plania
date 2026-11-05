"use client";

import { useEffect, useState } from "react";
import { getCachedTripCoverUrl, resolveTripCoverUrl } from "@/lib/trip-cover";

/**
 * The signed URL of a trip cover, or null while it resolves, offline, on error or when the
 * trip has no cover (then nothing is requested). The Supabase client is loaded only when there
 * is a cover to sign, so screens that render covers do not need it otherwise.
 */
export function useTripCoverUrl(path: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!path || getCachedTripCoverUrl(path)) return;
    let cancelled = false;
    void import("@/lib/supabase")
      .then(({ supabase }) => resolveTripCoverUrl(path, supabase as never))
      .catch(() => null)
      .then((url) => {
        if (!cancelled) setResolved({ path, url });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  return getCachedTripCoverUrl(path) ?? (resolved?.path === path ? resolved.url : null);
}
