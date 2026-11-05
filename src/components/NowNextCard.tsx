"use client";

import { FileText, MapPin } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import type { Activity, ActivityFile } from "@/lib/types";

type Props = {
  now?: Activity;
  next?: Activity;
  /** Opens a document of the activity in the viewer. */
  onOpenFile: (file: ActivityFile, title: string) => void;
  /** Brings the activity's card in the timeline into view. */
  onShowActivity: (activityId: string) => void;
};

const mapsHref = (activity: Activity) =>
  activity.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location ?? "")}`;

/** Today mode: what is on now and what comes next, with address and document one tap away. */
export function NowNextCard({ now, next, onOpenFile, onShowActivity }: Props) {
  const { t } = useI18n();
  if (!now && !next) return null;

  const row = (label: string, activity: Activity) => {
    const file = activity.files?.[0];
    return (
      <div key={activity.id} className="flex items-center gap-3 min-w-0">
        <span className="w-16 shrink-0 text-[10px] font-black uppercase tracking-widest text-[var(--color-primary)]">{label}</span>
        <button
          type="button"
          onClick={() => onShowActivity(activity.id)}
          aria-label={t("now_next_show", { title: activity.title })}
          className="flex-1 min-w-0 text-left"
        >
          <span className="block text-sm font-bold text-[var(--color-text)] truncate">
            <span className="tabular-nums text-[var(--color-text-secondary)] mr-2">{activity.time}</span>
            {activity.title}
          </span>
        </button>
        {activity.location && (
          <a
            href={mapsHref(activity)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("now_next_open_map", { location: activity.location })}
            className="flex items-center gap-1 max-w-[40%] shrink-0 text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
          >
            <MapPin size={12} className="shrink-0" />
            <span className="truncate">{activity.location}</span>
          </a>
        )}
        {file && (
          <button
            type="button"
            onClick={() => onOpenFile(file, activity.title)}
            aria-label={t("now_next_open_document", { title: activity.title })}
            className="size-8 shrink-0 rounded-xl bg-[var(--color-primary-subtle)] text-[var(--color-primary)] flex items-center justify-center"
          >
            <FileText size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <section
      aria-label={t("now_next_label")}
      className="mb-6 space-y-3 rounded-2xl border border-[var(--color-primary)]/30 bg-[var(--color-surface)] px-4 py-3"
    >
      {now && row(t("now_next_now"), now)}
      {next && row(t("now_next_next"), next)}
    </section>
  );
}
