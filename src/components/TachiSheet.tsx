"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { ChatPanel } from "@/components/ChatPanel";
import { TachiAvatar } from "@/components/TachiAvatar";
import { useChatStore } from "@/store/use-chat-store";

/** A suggested action: it either runs something (`onSelect`) or shows a form inside the sheet (`panel`). */
export type TachiAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect?: () => void;
  panel?: ReactNode;
};

/** First visit stays light: a few suggestions, no wall of text. */
export const MAX_TACHI_ACTIONS = 3;

/**
 * Tachi's sheet: where the user is (day, activity), what Tachi can do here, and the
 * conversation. Mobile: bottom sheet over a scrim. Desktop: non-modal right side panel.
 * Open state lives in the chat store, so every entry point opens the same sheet.
 */
export function TachiSheet({
  tripId,
  place,
  activity,
  actions,
  panelId: controlledPanelId,
  onPanelChange,
  children,
}: {
  tripId: string;
  /** "Kyoto · Thursday 14": the day the user is looking at. */
  place: string;
  /** Title of the activity the user opened Tachi from, when there is one. */
  activity?: string;
  actions: TachiAction[];
  /**
   * The action whose panel is open, when the parent controls it (e.g. to open Tachi straight
   * on a panel from elsewhere). Left undefined, the sheet keeps it on its own.
   */
  panelId?: string | null;
  onPanelChange?: (panelId: string | null) => void;
  /** Extra hints for this context (e.g. schedule fixes for the day). */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const isOpen = useChatStore((s) => s.isOpen);
  const close = useChatStore((s) => s.close);
  const [ownPanelId, setOwnPanelId] = useState<string | null>(null);
  const panelId = controlledPanelId !== undefined ? controlledPanelId : ownPanelId;
  const setPanelId = onPanelChange ?? setOwnPanelId;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? actions : actions.slice(0, MAX_TACHI_ACTIONS);
  const panel = actions.find((action) => action.id === panelId && action.panel);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, isOpen]);

  const closeSheet = () => {
    setPanelId(null);
    setShowAll(false);
    close();
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          {/* Scrim only on mobile: on desktop the panel sits beside the page, which stays usable. */}
          <motion.button
            type="button"
            aria-label={t("close_travel_agent")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeSheet}
            className="fixed inset-0 z-[80] cursor-default bg-[var(--color-text)]/40 backdrop-blur-sm md:hidden"
          />
          <motion.aside
            aria-label={t("travel_agent")}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[2rem] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:border-y-0 md:border-r-0"
          >
            <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
              <TachiAvatar size={40} />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-black text-[var(--color-text)]">{t("travel_agent")}</h2>
                <p className="truncate text-xs font-bold text-[var(--color-text-secondary)]">{place}</p>
                {activity && <p className="truncate text-xs text-[var(--color-text-muted)]">{activity}</p>}
              </div>
              <button
                type="button"
                onClick={closeSheet}
                aria-label={t("close_travel_agent")}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]"
              >
                <X size={17} />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {panel ? (
                <div className="space-y-3 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setPanelId(null)}
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-[var(--color-text-secondary)]"
                  >
                    <ChevronLeft size={16} /> {t("tachi_back")}
                  </button>
                  <h3 className="text-sm font-black text-[var(--color-text)]">{panel.label}</h3>
                  {panel.panel}
                </div>
              ) : (
                <>
                  {shown.length > 0 && (
                    <div role="group" aria-label={t("tachi_suggested_actions")} className="flex flex-wrap gap-2 px-5 pt-4">
                      {shown.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => (action.panel ? setPanelId(action.id) : action.onSelect?.())}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-accent-ai)]/10 px-4 text-xs font-bold text-[var(--color-text)] transition-colors hover:bg-[var(--color-accent-ai)]/20"
                        >
                          <span aria-hidden="true" className="text-[var(--color-accent-ai)]">{action.icon}</span>
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {!showAll && actions.length > MAX_TACHI_ACTIONS && (
                    <div className="px-5 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowAll(true)}
                        className="inline-flex min-h-11 items-center rounded-xl px-2 text-xs font-bold text-[var(--color-accent-ai)] hover:underline"
                      >
                        {t("tachi_more_actions")}
                      </button>
                    </div>
                  )}
                  {children ? <div className="px-5 pt-4">{children}</div> : null}
                  <ChatPanel tripId={tripId} />
                </>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
