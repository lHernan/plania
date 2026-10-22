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
      onClick={open}
      aria-label={t("open_travel_agent")}
      title={t("open_travel_agent")}
      className="fixed bottom-8 right-28 z-50 flex size-14 items-center justify-center rounded-2xl bg-emerald-900 text-white shadow-2xl shadow-emerald-900/30 ring-8 ring-emerald-900/10 transition-all hover:scale-105 hover:bg-emerald-800 active:scale-95"
    >
      <Bot size={25} />
    </button>
  );
}
