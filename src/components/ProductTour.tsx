"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import { TOUR_STEPS, tourKey, type TourStep } from "@/lib/tour/steps";

export const TOUR_SEEN_KEY = "tachao_tour_seen_v1";
/** Let the trip screen settle (fonts, sticky header, first data) before the first step. */
const AUTO_START_DELAY_MS = 1200;
const SPOT_PADDING = 8;
const CARD_WIDTH = 340;
const CARD_GAP = 14;

const anchorOf = (step: TourStep) => document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`);

/** In the DOM and actually displayed (Tailwind `hidden` on this screen size does not count). */
function isShown(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === "function") return element.checkVisibility();
  return true;
}

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return true; // Without storage, never pop up uninvited on every visit.
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // The replay button still works.
  }
}

/** First-run tour on this device, plus `start` for the "?" button. */
export function useProductTour(ready: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || readSeen()) return;
    const timer = setTimeout(() => setOpen(true), AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const start = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  return { open, start, close };
}

type Box = { top: number; left: number; width: number; height: number };

export function ProductTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <TourOverlay onClose={onClose} />;
}

function TourOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const nextRef = useRef<HTMLButtonElement>(null);
  // The sections on screen when the tour opens; read from the DOM once it is mounted.
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measuring the DOM after mount
    setSteps(TOUR_STEPS.filter((candidate) => {
      const element = anchorOf(candidate);
      return Boolean(element && isShown(element));
    }));
  }, []);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = steps?.[index];

  const measure = useCallback(() => {
    const element = step ? anchorOf(step) : null;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
  }, [step]);

  useLayoutEffect(() => {
    const element = step ? anchorOf(step) : null;
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    nextRef.current?.focus();
    // Smooth scrolling moves the section after this frame: measure on the next ones.
    let frame = requestAnimationFrame(measure);
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [measure, step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!steps || !step) return null;
  const isLast = index === steps.length - 1;
  const viewportW = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 768 : window.innerHeight;

  // A section taller than the screen is only lit where it is visible.
  const spot = box && {
    top: Math.max(box.top - SPOT_PADDING, 4),
    left: Math.max(box.left - SPOT_PADDING, 4),
    width: Math.min(box.width + SPOT_PADDING * 2, viewportW - 8),
    height: Math.min(box.height + SPOT_PADDING * 2, viewportH - Math.max(box.top - SPOT_PADDING, 4) - 4),
  };
  const cardWidth = Math.min(CARD_WIDTH, viewportW - 32);
  const cardLeft = spot ? Math.min(Math.max(spot.left, 16), viewportW - cardWidth - 16) : (viewportW - cardWidth) / 2;
  const spaceBelow = spot ? viewportH - (spot.top + spot.height) : viewportH;
  const cardStyle =
    !spot || (spaceBelow < 200 && spot.top < 200)
      ? { left: cardLeft, bottom: 16 }
      : spaceBelow >= 200
        ? { left: cardLeft, top: spot.top + spot.height + CARD_GAP }
        : { left: cardLeft, bottom: viewportH - spot.top + CARD_GAP };

  return createPortal(
    <div className="fixed inset-0 z-[1100]" aria-live="polite">
      {/* The dimmed screen with a hole over the current section. */}
      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-2xl ring-2 ring-[var(--color-primary)] transition-all duration-300"
          style={{ ...spot, boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.6)" }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-[rgba(15,23,42,0.6)]" />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed space-y-3 rounded-2xl bg-[var(--color-surface)] p-5 shadow-2xl"
        style={{ ...cardStyle, width: cardWidth }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-primary)]">
            {t("tour_progress", { current: index + 1, total: steps.length })}
          </span>
          <button type="button" onClick={onClose} className="text-[11px] font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {t("tour_skip")}
          </button>
        </div>
        <h2 id={titleId} className="text-base font-black text-[var(--color-text)]">{t(tourKey(step, "title"))}</h2>
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{t(tourKey(step, "body"))}</p>
        <div className="flex items-center justify-end gap-2 pt-1">
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              className="rounded-xl px-4 py-2 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
            >
              {t("tour_back")}
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={() => (isLast ? onClose() : setIndex((i) => i + 1))}
            className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-xs font-bold text-white hover:bg-[var(--color-primary-hover)]"
          >
            {t(isLast ? "tour_done" : "tour_next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
