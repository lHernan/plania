"use client";

import { Bot } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useChatStore } from "@/store/use-chat-store";

export function ChatFab() {
  const { t } = useI18n();
  const open = useChatStore((state) => state.open);

  return (
    <button
      type="button"
      data-tour="travel-agent"
      onClick={open}
      aria-label={t("open_travel_agent")}
      title={t("open_travel_agent")}
      // Positioned by its container (FloatingActions), never by itself.
      className="flex size-14 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white shadow-2xl shadow-[var(--color-primary)]/30 ring-8 ring-[var(--color-primary)]/10 transition-all hover:scale-105 hover:bg-[var(--color-primary-hover)] active:scale-95"
    >
      <Bot size={25} />
    </button>
  );
}
