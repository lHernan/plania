"use client";

import { useEffect, useState } from "react";
import { getCachedMemoryPhotoUrl, resolveMemoryPhotoUrl } from "@/lib/memory-photos";

/**
 * The signed URL of a memory photo, or null while it resolves, offline, on error or without a
 * path (then nothing is requested). The Supabase client is loaded only when there is a photo
 * to sign, so screens without photos do not need it.
 */
export function useMemoryPhotoUrl(path: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!path || getCachedMemoryPhotoUrl(path)) return;
    let cancelled = false;
    void import("@/lib/supabase")
      .then(({ supabase }) => resolveMemoryPhotoUrl(path, supabase as never))
      .catch(() => null)
      .then((url) => {
        if (!cancelled) setResolved({ path, url });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  return getCachedMemoryPhotoUrl(path) ?? (resolved?.path === path ? resolved.url : null);
}
