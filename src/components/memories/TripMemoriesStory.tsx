"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { CheckCircle2, Map as MapIcon } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemoryList } from "@/components/memories/MemoryList";
import { memoriesForActivity, memoryStoryDays, tripLevelMemories } from "@/lib/memories-view";
import { isTripUndated } from "@/lib/trip-undated";
import type { TripPlan } from "@/lib/types";

type TripMemoriesStoryProps = {
  trip: TripPlan;
  currentUserId: string | null;
  /** The map section, where the "Tachadas" filter shows what was crossed off. */
  mapHref: string;
};

/** Viaje › Recuerdos: trip memories first, then the story by day and a way to the map. */
export function TripMemoriesStory({ trip, currentUserId, mapHref }: TripMemoriesStoryProps) {
  const { t, lang } = useI18n();
  const locale = lang === "es" ? es : enUS;
  const memories = trip.memories ?? [];
  const undated = isTripUndated(trip);
  const days = memoryStoryDays(trip, memories);

  const dayTitle = (date: string, dayNumber: number) =>
    undated || !date ? t("trip_view_day_number", { number: dayNumber }) : format(parseISO(date), "EEEE d MMMM", { locale });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("memories_trip_heading")}</h3>
        <MemoryList
          tripId={trip.id}
          activityId={null}
          memories={tripLevelMemories(memories)}
          currentUserId={currentUserId}
          label={t("memories_trip_heading")}
          addLabel={t("memory_add_trip")}
        />
        <Link
          href={mapHref}
          className="min-h-11 inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary-subtle)] px-4 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary)]/15 transition-colors"
        >
          <MapIcon size={16} aria-hidden="true" />
          {t("memories_map_link")}
        </Link>
      </section>

      {days.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">{t("memories_story_empty")}</p>}

      {days.map(({ day, dayNumber, activities }) => (
        <section key={day.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
          <h3 className="text-sm font-black capitalize text-[var(--color-text)]">{dayTitle(day.date, dayNumber)}</h3>
          {activities.map((activity) => (
            <div key={activity.id} className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
                {activity.state === "completed" && <CheckCircle2 size={16} aria-hidden="true" className="shrink-0 text-[var(--color-success)]" />}
                <span>{activity.title}</span>
              </p>
              <MemoryList
                tripId={trip.id}
                activityId={activity.id}
                memories={memoriesForActivity(memories, activity.id)}
                currentUserId={currentUserId}
                label={t("memories_activity_list", { title: activity.title })}
                addLabel={t("memory_add")}
              />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
