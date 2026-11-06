"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { Loader2, Send } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { TachiAvatar } from "@/components/TachiAvatar";
import { ProposalCard } from "@/components/chat/ProposalCard";
import { AI_QUOTA_EXCEEDED } from "@/lib/ai/quota-client";
import { useChatStore } from "@/store/use-chat-store";

// i18n keys; the translated text is what gets filled into the input and sent to the agent.
const QUICK_PROMPT_KEYS = [
  "chat_quick_prompt_next",
  "chat_quick_prompt_summary",
  "chat_quick_prompt_gaps",
  "chat_quick_prompt_missing",
];

/**
 * The conversation with Tachi (history in trip_messages). It lives inside the Tachi sheet.
 * `canEdit` (owner or editor) lets the user apply the changes Tachi proposes in this session.
 */
export function ChatPanel({ tripId, canEdit = false }: { tripId: string; canEdit?: boolean }) {
  const { lang, t } = useI18n();
  const endRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    proposals,
    loadedTripId,
    loadingHistory,
    sending,
    error,
    draft,
    setDraft,
    loadMessages,
    sendMessage,
  } = useChatStore();

  useEffect(() => {
    if (tripId) void loadMessages(tripId);
  }, [loadMessages, tripId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const submit = async (event: FormEvent<HTMLFormElement> | KeyboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    await sendMessage(tripId, message, lang);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {loadedTripId !== tripId || loadingHistory ? (
          <div className="flex min-h-24 items-center justify-center text-[var(--color-text-muted)]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs leading-relaxed text-[var(--color-text-muted)]">{t("agent_welcome_hint")}</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex items-end gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              {message.role === "assistant" && <TachiAvatar size={22} />}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "rounded-br-md bg-[var(--color-primary)] text-white" : "rounded-bl-md bg-[var(--color-surface-subtle)] text-[var(--color-text)]"}`}>
                {message.content}
                {message.actions && message.actions.length > 0 ? (
                  canEdit && proposals[message.id] ? (
                    <ProposalCard tripId={tripId} messageId={message.id} actions={message.actions} status={proposals[message.id]} />
                  ) : (
                    <div className="mt-2 border-t border-current/10 pt-2 text-[10px] font-bold uppercase tracking-wider opacity-70">
                      {t("agent_actions_proposed", { count: message.actions.length })}
                    </div>
                  )
                ) : null}
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="flex items-end gap-2">
            <TachiAvatar size={22} state="thinking" />
            <div className="rounded-2xl rounded-bl-md bg-[var(--color-surface-subtle)] px-4 py-3 text-[var(--color-text-muted)]">
              <Loader2 size={16} className="animate-spin" />
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p className="flex items-center gap-2 px-5 pb-2 text-xs font-medium text-[var(--color-danger)]">
          <TachiAvatar size={18} state="error" />
          {error === AI_QUOTA_EXCEEDED ? t("ai_quota_exceeded") : error}
        </p>
      ) : null}

      <div className="border-t border-[var(--color-border)] px-5 py-3">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {QUICK_PROMPT_KEYS.map((promptKey) => t(promptKey)).map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setDraft(prompt)}
              className="min-h-11 shrink-0 rounded-full border border-[var(--color-primary)]/20 bg-[var(--color-primary-subtle)] px-3 text-[10px] font-bold text-[var(--color-primary)]"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(event);
              }
            }}
            rows={1}
            aria-label={t("agent_input_placeholder")}
            placeholder={t("agent_input_placeholder")}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 text-[var(--color-text)]"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label={t("send_message")}
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white transition-all hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}
