import Image from "next/image";

/**
 * The landing's images. The curated, licensed photo set and the real screenshots do not exist
 * yet: each slot is null and shows a token-based placeholder. Set a path under /public (never a
 * third-party URL) to replace it.
 */
export const LANDING_IMAGES: Record<"hero" | "valuePlan" | "valueAll" | "valueLive", string | null> = {
  hero: null,
  valuePlan: null,
  valueAll: null,
  valueLive: null,
};

/** The gradient shown in the theme's colors where no photo exists yet (landing slots, trip covers). */
export const IMAGE_PLACEHOLDER_CLASS =
  "bg-gradient-to-br from-[var(--color-primary)]/25 via-[var(--color-accent-ai)]/15 to-[var(--color-warning)]/20";

/** One replaceable image: the photo when there is one, otherwise a gradient in the theme's colors. */
export function ImageSlot({ src, alt, className = "", priority = false }: { src: string | null; alt: string; className?: string; priority?: boolean }) {
  return (
    <div className={`relative overflow-hidden ${className}`.trim()} data-testid="image-slot">
      {src ? (
        <Image src={src} alt={alt} fill priority={priority} sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className={`absolute inset-0 ${IMAGE_PLACEHOLDER_CLASS}`}
        />
      )}
    </div>
  );
}
