"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Loader2, Send, Sparkles, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useChatStore } from "@/store/use-chat-store";

const QUICK_PROMPTS = [
  "What's next on my itinerary?",
  "Summarize my day",
  "Find schedule gaps",
  "What trip details are missing?",
];

export function ChatPanel({ tripId }: { tripId: string }) {
  const { lang, t } = useI18n();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const {
    isOpen,
    messages,
    loadedTripId,
    loadingHistory,
    sending,
    error,
    close,
    loadMessages,
    sendMessage,
  } = useChatStore();

  useEffect(() => {
    if (isOpen && tripId) void loadMessages(tripId);
  }, [isOpen, loadMessages, tripId]);

  useEffect(() => {
    if (isOpen) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [isOpen, messages, sending]);

  const submit = async (event: FormEvent<HTMLFormElement> | KeyboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    await sendMessage(tripId, message, lang);
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.button
            type="button"
            aria-label={t("close_travel_agent")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-[80] cursor-default bg-stone-950/40 backdrop-blur-sm"
          />
          <motion.section
            aria-label={t("travel_agent")}
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed inset-x-0 bottom-0 z-[90] mx-auto flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[2rem] border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-950 md:bottom-6 md:rounded-[2rem]"
          >
            <header className="flex items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-stone-800">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <Bot size={20} />
                </div>
                <div>
                  <h2 className="text-sm font-black text-stone-900 dark:text-white">{t("travel_agent")}</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                    {t("agent_read_only")}
                  </p>
                </div>
              </div>
              <button type="button" onClick={close} className="flex size-9 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-900">
                <X size={17} />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {loadedTripId !== tripId || loadingHistory ? (
                <div className="flex min-h-40 items-center justify-center text-stone-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="py-8 text-center">
                  <Sparkles size={28} className="mx-auto mb-3 text-emerald-700" />
                  <p className="text-sm font-bold text-stone-700 dark:text-stone-200">{t("agent_welcome")}</p>
                  <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-stone-400">{t("agent_welcome_hint")}</p>
                </div>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "rounded-br-md bg-emerald-900 text-white" : "rounded-bl-md bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200"}`}>
                      {message.content}
                      {message.actions && message.actions.length > 0 ? (
                        <div className="mt-2 border-t border-current/10 pt-2 text-[10px] font-bold uppercase tracking-wider opacity-70">
                          {t("agent_actions_applied", { count: message.actions.length })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {sending ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-stone-100 px-4 py-3 text-stone-400 dark:bg-stone-900">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            {error ? <p className="px-5 pb-2 text-xs font-medium text-rose-500">{error}</p> : null}

            <div className="border-t border-stone-100 px-5 py-3 dark:border-stone-800">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="shrink-0 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <form onSubmit={submit} className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit(event);
                    }
                  }}
                  rows={1}
                  placeholder={t("agent_input_placeholder")}
                  className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-800 dark:border-stone-800 dark:bg-stone-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label={t("send_message")}
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-900 text-white transition-all hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send size={17} />
                </button>
              </form>
            </div>
          </motion.section>
        </>
      ) : null}
    </AnimatePresence>
  );
}
