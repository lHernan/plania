"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bed,
  Camera,
  CheckCircle2,
  ExternalLink,
  GripVertical,
  Info,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Ticket,
  Music,
  Plane,
  ShoppingBag,
  Utensils,
} from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { OriginBadge } from "@/components/OriginBadge";
import type { Activity, ActivityCategory, ActivityFile } from "@/lib/types";

export const CATEGORY_STYLES: Record<ActivityCategory, { icon: any; color: string; bg: string }> = {
  sightseeing: { icon: MapIcon, color: "text-[#246B57]", bg: "bg-[#E4F0E9]" },
  reservation: { icon: CheckCircle2, color: "text-[#246B57]", bg: "bg-[#E4F0E9]" },
  transport: { icon: Plane, color: "text-[#3269B2]", bg: "bg-[#3269B2]/10" },
  hotel: { icon: Bed, color: "text-[#966B32]", bg: "bg-[#966B32]/10" },
  food: { icon: Utensils, color: "text-[#B54747]", bg: "bg-[#B54747]/10" },
  shopping: { icon: ShoppingBag, color: "text-[#A779C5]", bg: "bg-[#A779C5]/10" },
  photos: { icon: Camera, color: "text-[#3269B2]", bg: "bg-[#3269B2]/10" },
  nightlife: { icon: Music, color: "text-[#A779C5]", bg: "bg-[#A779C5]/10" },
  other: { icon: Info, color: "text-[var(--color-text-muted)]", bg: "bg-[var(--color-surface-subtle)]" },
};

export const getCategoryStyle = (category: string) =>
  CATEGORY_STYLES[category as ActivityCategory] ??
  CATEGORY_STYLES["other" as ActivityCategory];

export function SortableActivityCard({
  activity,
  onComplete,
  onUncomplete,
  onEdit,
  onComment,
  onOpenFile,
  justCompleted = false,
}: {
  activity: Activity;
  onComplete: (activityId: string) => void;
  onUncomplete: (activityId: string) => void;
  onEdit: () => void;
  onComment?: () => void;
  /** Opens an attachment (boarding pass, ticket) straight from the card. */
  onOpenFile?: (file: ActivityFile) => void;
  /** True only right after the user completed it, so loads and day switches never animate. */
  justCompleted?: boolean;
}) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  // PDFs first: boarding passes and tickets usually come as PDFs.
  const pass = [...(activity.files ?? [])].sort((a, b) => Number(b.fileType === "pdf") - Number(a.fileType === "pdf"))[0];
  const animateCompletion = justCompleted && !reducedMotion;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: activity.id,
  });
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
  };

  const completed = activity.state === "completed";

  return (
    <motion.div
      id={`activity-${activity.id}`}
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: isDragging ? 1.02 : 1,
      }}
      exit={{ opacity: 0, scale: 0.95 }}
      layout={!reducedMotion}
      className={`group overflow-hidden rounded-2xl border transition-[background-color,border-color,box-shadow] duration-500 cursor-pointer ${
        completed
          ? "bg-[var(--color-primary-subtle)]/50 border-[var(--color-primary-subtle)] hover:border-[var(--color-border-strong)]"
          : "bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm hover:shadow-md hover:border-[var(--color-border-strong)]"
      }`}
      onClick={onEdit}
      onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStart && e.changedTouches[0].clientX - touchStart > 70 && !completed) {
          onComplete(activity.id);
        }
      }}
    >
      <div className="relative p-4 flex gap-3 items-center">
        {/* DRAG HANDLE */}
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-1 top-1/2 -translate-y-1/2 p-2 hover:bg-[var(--color-surface-subtle)] rounded-lg transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 md:opacity-100 md:bg-transparent bg-[var(--color-surface)]"
        >
          <GripVertical size={16} className="text-[var(--color-text-muted)]" />
        </div>

        {/* TIME & ICON GROUP */}
        <div className="flex flex-col items-center gap-2 shrink-0 ml-4 md:ml-6 pointer-events-none">
          <div className={`size-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${
            completed
              ? "bg-[var(--color-surface)] text-[var(--color-primary)]/70"
              : `${getCategoryStyle(activity.category).bg} ${getCategoryStyle(activity.category).color}`
          }`}>
            {(() => {
              const Icon = getCategoryStyle(activity.category).icon;
              return <Icon size={24} strokeWidth={2.5} />;
            })()}
          </div>
          
          <div className="flex flex-col items-center gap-1">
            <span className={`text-[11px] font-black tracking-tighter tabular-nums transition-colors ${
              completed ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"
            }`}>
              {activity.time}
            </span>
            {!completed && activity.timeInferred && (
              <span 
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-[4px] text-[7.5px] font-black uppercase tracking-widest bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/20 cursor-help select-none hover:scale-105 active:scale-95 transition-all pointer-events-auto"
                title={t("confidence_tooltip", { confidence: Math.round((activity.timeConfidence || 0.85) * 100) })}
              >
                ✨ {t("suggested_time")}
              </span>
            )}
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 min-w-0 py-1">
          <div className="flex items-center gap-2 mb-1">
             <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full ${
                completed
                  ? "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                  : `${getCategoryStyle(activity.category).bg} ${getCategoryStyle(activity.category).color}`
             }`}>
              {t(activity.category)}
            </span>
            {activity.durationMin ? (
              <span className="text-[10px] text-[var(--color-text-muted)] font-bold uppercase tracking-widest tabular-nums">
                · {activity.durationMin}{t("mins_short")}
              </span>
            ) : null}
            <OriginBadge activity={activity} className="ml-auto shrink-0" />
          </div>

          <h4
            className={`text-base font-extrabold leading-tight transition-colors duration-500 truncate ${
              completed
                ? "text-[var(--color-text-secondary)] line-through decoration-[var(--color-primary)]/50 decoration-2"
                : "text-[var(--color-text)]"
            }`}
          >
            {activity.title}
          </h4>
          
          <div className="flex items-center gap-1.5 mt-2">
            <MapPin size={12} className={completed ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-muted)] shrink-0"} />
            {activity.location ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const url = activity.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location as string)}`;
                  window.open(url, "_blank");
                }}
                className={`text-xs font-medium truncate flex items-center gap-1 hover:underline transition-all ${completed ? "text-[var(--color-text-muted)]" : "text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"}`}
              >
                {activity.location}
                <ExternalLink size={10} className="shrink-0" />
              </button>
            ) : (
              <span className={`text-xs font-medium truncate ${completed ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-secondary)]"}`}>
                {t("location_pending")}
              </span>
            )}
          </div>
        </div>

        {/* ACTION GROUP */}
        <div className="flex items-center gap-1">
          {onOpenFile && pass && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenFile(pass);
              }}
              aria-label={t("activity_open_pass", { title: activity.title })}
              title={t("activity_open_pass", { title: activity.title })}
              className="size-7 rounded-lg flex items-center justify-center text-[var(--color-primary)] bg-[var(--color-primary-subtle)] hover:brightness-95 transition-all"
            >
              <Ticket size={15} />
            </button>
          )}
          {onComment && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onComment(); }}
              className="size-7 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)] transition-all"
            >
              <MessageCircle size={15} />
            </button>
          )}
          {/* 44px touch target around a compact visual checkbox */}
          <button
            type="button"
            role="checkbox"
            aria-checked={completed}
            aria-label={t(completed ? "activity_mark_pending_aria" : "activity_mark_completed_aria", { title: activity.title })}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (completed) {
                onUncomplete(activity.id);
              } else {
                onComplete(activity.id);
              }
            }}
            className="group/check -m-2 size-11 md:size-9 shrink-0 flex items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
          >
            <motion.span
              animate={animateCompletion ? { scale: [1, 1.18, 1] } : undefined}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className={`size-7 md:size-6 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                completed
                  ? "bg-[var(--color-primary)] border-2 border-[var(--color-primary)] text-white"
                  : "border-2 border-[var(--color-border-strong)] group-hover/check:border-[var(--color-primary)] bg-[var(--color-surface)]"
              }`}
            >
              {completed && (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <motion.path
                    d="M2.5 7.5l3 3 6-6.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={animateCompletion ? { pathLength: 0 } : false}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </svg>
              )}
            </motion.span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
