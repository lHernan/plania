"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useI18n } from "@/components/I18nProvider";
import { ConfettiParticles } from "@/components/ConfettiParticles";
import type { CelebrationEvent } from "@/hooks/use-celebration";

type Props = {
  event: CelebrationEvent | null;
  onDismiss: () => void;
  onNextDay?: (dayId: string) => void;
};

export function CelebrationOverlay({ event, onDismiss, onNextDay }: Props) {
  const { t } = useI18n();
  const reduced = useReducedMotion();

  // Auto-dismiss timer
  useEffect(() => {
    if (!event) return;
    const ms = event.tier === 1 ? 1800 : 4000;
    const timer = setTimeout(onDismiss, ms);
    return () => clearTimeout(timer);
  }, [event, onDismiss]);

  return (
    <AnimatePresence>
      {event?.tier === 1 && (
        <motion.div
          key="celebration-toast"
          initial={{ y: 20, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.95 }}
          transition={reduced ? { duration: 0 } : { type: "spring", damping: 20, stiffness: 300 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[130] px-6 py-3 rounded-2xl shadow-2xl bg-[var(--color-text)] text-white"
        >
          <p className="text-sm font-black tracking-tight text-center">
            {t("tachao_activity")}
          </p>
          <p className="text-[10px] font-medium text-white/70 text-center mt-0.5">
            {t("tachao_activity_sub")}
          </p>
        </motion.div>
      )}

      {event && event.tier >= 2 && (
        <motion.div
          key="celebration-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.3 }}
          onClick={onDismiss}
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-sm"
        >
          {!reduced && (
            <ConfettiParticles count={event.tier === 3 ? 50 : 30} />
          )}

          <motion.div
            initial={reduced ? { opacity: 1 } : { scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { scale: 0.8, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", damping: 15, stiffness: 200 }}
            onClick={(e) => e.stopPropagation()}
            className="text-center space-y-4 p-8 rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl max-w-xs mx-4"
          >
            <p className="text-3xl font-black tracking-tight text-[var(--color-text)]">
              {event.tier === 3 ? t("tachao_trip") : t("tachao_day")}
            </p>
            <p className="text-sm text-[var(--color-text-secondary)] font-medium leading-relaxed">
              {event.tier === 3 ? t("tachao_trip_sub") : t("tachao_day_sub")}
            </p>

            {event.tier === 2 && event.nextDayId && onNextDay && (
              <button
                onClick={() => onNextDay(event.nextDayId!)}
                className="mt-2 px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white font-bold text-sm hover:bg-[var(--color-primary-hover)] transition-colors"
              >
                {t("tachao_day_next")}
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
