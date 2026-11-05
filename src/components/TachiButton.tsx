"use client";

import { useI18n } from "@/components/I18nProvider";
import { TachiAvatar } from "@/components/TachiAvatar";

/**
 * The one floating door to the AI. The caller decides what a tap does: open Tachi for a
 * registered user, or the sign-in sheet for a visitor. Positioned by its container.
 */
export function TachiButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      data-tour="travel-agent"
      onClick={onClick}
      aria-label={t("open_travel_agent")}
      title={t("open_travel_agent")}
      className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-surface)] shadow-2xl shadow-[var(--color-accent-ai)]/30 ring-8 ring-[var(--color-accent-ai)]/15 transition-all hover:scale-105 active:scale-95"
    >
      <TachiAvatar size={34} />
    </button>
  );
}
