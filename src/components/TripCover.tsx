"use client";

import { useState } from "react";
import { IMAGE_PLACEHOLDER_CLASS } from "@/components/landing/ImageSlot";
import { useTripCoverUrl } from "@/hooks/use-trip-cover";
import { forgetTripCoverUrl } from "@/lib/trip-cover";

/**
 * The uploaded cover filling its (positioned) parent, or nothing: the parent's own look is
 * the placeholder. Signed URLs are remote and short-lived, so a plain img is used (next/image
 * would need the storage host in remotePatterns and would cache an expiring URL).
 */
export function TripCoverImage({ path }: { path?: string | null }) {
  const url = useTripCoverUrl(path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || url === failedUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed URL of a private bucket
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
      onError={() => {
        if (path) forgetTripCoverUrl(path);
        setFailedUrl(url);
      }}
    />
  );
}

/** A cover band: the uploaded photo, or the default gradient until the curated set exists. */
export function TripCover({ path, className = "" }: { path?: string | null; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`.trim()} data-testid="trip-cover">
      <div aria-hidden="true" className={`absolute inset-0 ${IMAGE_PLACEHOLDER_CLASS}`} />
      <TripCoverImage path={path} />
    </div>
  );
}
