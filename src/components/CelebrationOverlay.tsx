"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useI18n } from "@/components/I18nProvider";
import { ConfettiParticles } from "@/components/ConfettiParticles";
import type { CelebrationEvent } from "@/hooks/use-celebration";

type Props = {
  event: CelebrationEvent | null;
  onDismiss: () => void;
  onNextDay?: (dayId: string) => void;
};

const TOAST_MS = 1800;
const MILESTONE_MS = 5000;

/** Check mark that draws itself; static when motion is reduced. */
export function DrawnCheck({ size = 44, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true" className="shrink-0">
      <circle cx="22" cy="22" r="22" fill="var(--color-primary)" />
      <motion.path
        d="M13 22.5l6 6L31 16"
        fill="none"
        stroke="white"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, delay: 0.15, ease: "easeOut" }}
      />
    </svg>
  );
}

export function CelebrationOverlay({ event, onDismiss, onNextDay }: Props) {
  const { t } = useI18n();
  const reduced = useReducedMotion();

  // Auto-dismiss; a new event (new id) restarts the timer.
  useEffect(() => {
    if (!event) return;
    const timer = setTimeout(onDismiss, event.tier === 1 ? TOAST_MS : MILESTONE_MS);
    return () => clearTimeout(timer);
  }, [event, onDismiss]);

  const isTrip = event?.tier === 3;
  const toastSub =
    event?.kind === "shopping"
      ? t("tachao_shopping_sub", { item: event.activityTitle })
      : event?.kind === "reservation"
        ? t("tachao_reservation_sub", { item: event.activityTitle })
        : event?.kind === "tour"
          ? t("tachao_tour_sub")
          : t("tachao_activity_sub");
  const showNext = event?.tier === 2 && !!event.nextDayId && !!onNextDay;

  return (
    <>
      {/* Screen reader announcement, independent of the animation. */}
      <div role="status" aria-live="polite" className="sr-only">
        {event?.tier === 1 && `${t("tachao_activity")} ${toastSub}`}
        {event?.tier === 2 && `${t("tachao_day")} ${t("tachao_day_sub")}`}
        {event?.tier === 3 && `${t("tachao_trip")} ${t("tachao_trip_sub")}`}
      </div>

      <AnimatePresence>
        {event?.tier === 1 && (
          <motion.div
            key="celebration-toast"
            initial={reduced ? { opacity: 0 } : { y: -12, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { y: -12, opacity: 0, scale: 0.96 }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", damping: 22, stiffness: 320 }}
            aria-hidden="true"
            className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+4.5rem)] z-[130] -translate-x-1/2 flex items-center gap-3 rounded-2xl bg-[var(--color-text)] py-2.5 pl-2.5 pr-5 text-white shadow-lg"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-[var(--color-primary)]">
              <Check size={15} strokeWidth={3} />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-black tracking-tight">{t("tachao_activity")}</span>
              <span className="text-[11px] font-medium text-white/70">{toastSub}</span>
            </span>
          </motion.div>
        )}

        {event && event.tier >= 2 && (
          <motion.div
            key={`celebration-milestone-${event.tier}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.15 : 0.25 }}
            // Non-blocking: only the card itself receives pointer events.
            className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] z-[130] flex justify-center px-4 md:bottom-10"
          >
            {!reduced && <ConfettiParticles count={isTrip ? 44 : 26} />}

            <motion.div
              initial={reduced ? false : { y: 24, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              exit={reduced ? undefined : { y: 24, scale: 0.96 }}
              transition={reduced ? { duration: 0 } : { type: "spring", damping: 20, stiffness: 240 }}
              className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
            >
              {/* Warm accent line that "crosses out" the day/trip. */}
              <motion.span
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
                className="absolute inset-x-0 top-0 h-1 origin-left bg-[var(--color-celebration)]"
              />
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t("tachao_dismiss")}
                className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
              >
                <X size={16} />
              </button>
              <div className="flex items-start gap-4 pr-6">
                <DrawnCheck animate={!reduced} />
                <div className="space-y-1">
                  <p className="text-xl font-black tracking-tight text-[var(--color-text)]">
                    {isTrip ? t("tachao_trip") : t("tachao_day")}
                  </p>
                  <p className="text-sm leading-snug text-[var(--color-text-secondary)]">
                    {isTrip ? t("tachao_trip_sub") : t("tachao_day_sub")}
                  </p>
                </div>
              </div>
              {showNext && (
                <button
                  type="button"
                  onClick={() => onNextDay!(event.nextDayId!)}
                  className="mt-4 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
                >
                  {t("tachao_day_next")}
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
