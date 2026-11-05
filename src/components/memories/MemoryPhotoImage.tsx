"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { useMemoryPhotoUrl } from "@/hooks/use-memory-photo";
import { forgetMemoryPhotoUrl } from "@/lib/memory-photos";

/**
 * A memory photo filling its box, or a placeholder while it resolves, offline or when it fails.
 * Signed URLs are remote and short-lived, so a plain img is used (as for trip covers).
 */
export function MemoryPhotoImage({ path, alt, placeholderLabel, className = "" }: { path: string; alt: string; placeholderLabel: string; className?: string }) {
  const url = useMemoryPhotoUrl(path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const box = `relative overflow-hidden rounded-xl bg-[var(--color-surface-subtle)] ${className}`.trim();

  if (!url || url === failedUrl) {
    return (
      <div role="img" aria-label={placeholderLabel} className={`${box} flex items-center justify-center text-[var(--color-text-muted)]`}>
        <ImageOff size={20} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={box}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL of a private bucket */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => {
          forgetMemoryPhotoUrl(path);
          setFailedUrl(url);
        }}
      />
    </div>
  );
}
