"use client";

import { Pencil, Star, Users } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemoryPhotoImage } from "@/components/memories/MemoryPhotoImage";
import { memoryPerson, memoryViewers } from "@/lib/memories-view";
import type { Memory, TripMember } from "@/lib/types";

/** "Tú", the member's email, or a neutral name when the member list is not available. */
export function useMemoryPersonName(currentUserId: string | null, members: TripMember[]) {
  const { t } = useI18n();
  return (userId: string) => {
    const person = memoryPerson(userId, currentUserId, members);
    if (person.kind === "you") return t("memory_author_you");
    return person.kind === "email" ? person.email : t("memory_author_unknown");
  };
}

export function MemoryRating({ rating }: { rating: number }) {
  const { t } = useI18n();
  return (
    <span role="img" aria-label={t("memory_rating_aria", { count: rating })} className="inline-flex gap-0.5 text-[var(--color-warning)]">
      {[1, 2, 3, 4, 5].map((value) => (
        <Star key={value} size={14} aria-hidden="true" fill={value <= rating ? "currentColor" : "none"} className={value <= rating ? "" : "text-[var(--color-text-muted)]"} />
      ))}
    </span>
  );
}

type MemoryCardProps = {
  memory: Memory;
  currentUserId: string | null;
  members: TripMember[];
  /** Only offered to the author; everyone else sees the memory read-only. */
  onEdit?: () => void;
};

/** One memory: photos, note, rating, author and, when shared with some people, who sees it. */
export function MemoryCard({ memory, currentUserId, members, onEdit }: MemoryCardProps) {
  const { t } = useI18n();
  const nameOf = useMemoryPersonName(currentUserId, members);
  const isAuthor = Boolean(currentUserId) && memory.authorId === currentUserId;

  return (
    <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
      {memory.photos.length > 0 && (
        <div className={`grid gap-2 ${memory.photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {memory.photos.map((photo, index) => (
            <MemoryPhotoImage
              key={photo.id}
              path={photo.path}
              alt={photo.caption ?? t("memory_photo_alt", { number: index + 1 })}
              placeholderLabel={t("memory_photo_unavailable")}
              className={memory.photos.length === 1 ? "aspect-[4/3]" : "aspect-square"}
            />
          ))}
        </div>
      )}
      {memory.note && <p className="whitespace-pre-line text-sm text-[var(--color-text)]">{memory.note}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        {memory.rating ? <MemoryRating rating={memory.rating} /> : null}
        <span className="font-semibold">{nameOf(memory.authorId)}</span>
        {memory.audience === "selected" && (
          <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]">
            <Users size={12} aria-hidden="true" />
            <span>{t("memory_only", { names: memoryViewers(memory).map(nameOf).join(", ") })}</span>
          </span>
        )}
        {isAuthor && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={t("memory_edit")}
            className="ml-auto inline-flex size-11 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-primary)] transition-colors"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}
