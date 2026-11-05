"use client";

import { BookOpen, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemoryRating } from "@/components/memories/MemoryCard";
import { publicStoryDays, publicTripMemories, type PublicStoryActivity } from "@/lib/share/public-story";
import type { PublicMemory } from "@/lib/types";

/** A memory on the public page: photos (already signed by the server), note and rating; never its author. */
function PublicMemoryCard({ memory }: { memory: PublicMemory }) {
  const { t } = useI18n();
  return (
    <article className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
      {memory.photos.length > 0 && (
        <div className={`grid gap-2 ${memory.photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {memory.photos.map((photo, index) => (
            <div key={photo.id} className={`relative overflow-hidden rounded-xl bg-[var(--color-surface-subtle)] ${memory.photos.length === 1 ? "aspect-[4/3]" : "aspect-square"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private bucket */}
              <img src={photo.url} alt={photo.caption ?? t("memory_photo_alt", { number: index + 1 })} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            </div>
          ))}
        </div>
      )}
      {memory.note && <p className="whitespace-pre-line text-sm text-[var(--color-text)]">{memory.note}</p>}
      {memory.rating ? <MemoryRating rating={memory.rating} /> : null}
    </article>
  );
}

type PublicTripStoryProps<Day extends { id: string }> = {
  days: Day[];
  activities: PublicStoryActivity[];
  memories: PublicMemory[];
  coverUrl?: string;
  tripName: string;
  dayTitle: (day: Day, index: number) => string;
};

/** "La historia del viaje" of the share page: trip memories first, then each day's completed activities. */
export function PublicTripStory<Day extends { id: string }>({ days, activities, memories, coverUrl, tripName, dayTitle }: PublicTripStoryProps<Day>) {
  const { t } = useI18n();
  const tripMemories = publicTripMemories(memories, activities);
  const storyDays = publicStoryDays(days, activities, memories);

  return (
    <section className="bg-[var(--color-surface)] backdrop-blur-xl border border-[var(--color-border)] rounded-3xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen size={16} aria-hidden="true" className="text-[var(--color-primary)]" />
        <h2 className="text-base font-black text-[var(--color-text)]">{t("share_story_title")}</h2>
      </div>
      {coverUrl && (
        <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-[var(--color-surface-subtle)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private bucket */}
          <img src={coverUrl} alt={t("share_story_cover_alt", { name: tripName })} className="absolute inset-0 h-full w-full object-cover" />
        </div>
      )}
      {tripMemories.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("memories_trip_heading")}</h3>
          {tripMemories.map((memory) => <PublicMemoryCard key={memory.id} memory={memory} />)}
        </div>
      )}
      {storyDays.map(({ day, dayNumber, activities: dayActivities }) => (
        <div key={day.id} className="space-y-3">
          <h3 className="text-sm font-black text-[var(--color-text)]">{dayTitle(day, dayNumber - 1)}</h3>
          {dayActivities.map(({ activity, memories: own }) => (
            <div key={activity.id} className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
                {activity.state === "completed" && <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-[var(--color-success)]" />}
                <span>{activity.title}</span>
              </p>
              {own.map((memory) => <PublicMemoryCard key={memory.id} memory={memory} />)}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
