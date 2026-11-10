"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useTripMembers } from "@/components/memories/use-trip-members";
import { refreshTripExpenses } from "@/hooks/use-trip-expenses";
import { applyChatActions, describeChatAction, type ProposalStatus } from "@/lib/chat/proposals";
import { saveExpense, type ExpensesClient } from "@/lib/expenses/sync";
import { supabase } from "@/lib/supabase";
import { memberShortName } from "@/lib/trip-people";
import type { ChatAction, ChatExpensePayload } from "@/lib/types";
import { useChatStore } from "@/store/use-chat-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

type ProposalCardProps = {
  tripId: string;
  messageId: string;
  actions: ChatAction[];
  status: ProposalStatus;
};

/** Tachi's proposed changes: nothing touches the trip until the user taps Apply. */
export function ProposalCard({ tripId, messageId, actions, status }: ProposalCardProps) {
  const { lang, t } = useI18n();
  const activeTrip = useItineraryStore((state) => state.activeTrip);
  const setProposalStatus = useChatStore((state) => state.setProposalStatus);
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const trip = activeTrip?.id === tripId ? activeTrip : { days: [], travelContext: undefined };
  const hasExpense = actions.some((action) => action.type === "add_expense");
  const { members } = useTripMembers(tripId, hasExpense);
  const nameOf = (userId: string) => {
    const member = members.find((entry) => entry.userId === userId);
    return member ? memberShortName(member) : t("expenses_former_member");
  };
  // Expenses go through the same save_expense RPC as the manual form, then every view reloads.
  const saveProposedExpense = async (expense: ChatExpensePayload) => {
    const saved = await saveExpense(supabase as unknown as ExpensesClient, { ...expense, tripId });
    if (saved.error) return false;
    refreshTripExpenses(tripId);
    return true;
  };

  const apply = async () => {
    setApplying(true);
    setFailed(false);
    try {
      const store = useItineraryStore.getState();
      const result = await applyChatActions(actions, () => {
        const current = useItineraryStore.getState().activeTrip;
        return current?.id === tripId ? current : null;
      }, { ...store, saveExpense: saveProposedExpense });
      if (result.applied === 0) {
        setFailed(true);
        return;
      }
      setSkipped(result.skipped);
      setProposalStatus(messageId, "applied");
    } catch {
      setFailed(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
        {t("chat_proposal_title", { count: actions.length })}
      </p>
      <ul className="mt-2 space-y-1.5 text-xs font-medium text-[var(--color-text)]">
        {actions.map((action, index) => (
          <li key={index}>{describeChatAction(action, trip, t, lang, nameOf)}</li>
        ))}
      </ul>
      {failed ? (
        <p role="alert" className="mt-2 text-xs font-medium text-[var(--color-danger)]">{t("chat_proposal_failed")}</p>
      ) : null}
      {status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void apply()}
            disabled={applying}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-3 text-xs font-bold text-white disabled:opacity-60"
          >
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t("chat_proposal_apply")}
          </button>
          <button
            type="button"
            onClick={() => setProposalStatus(messageId, "dismissed")}
            disabled={applying}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3 text-xs font-bold text-[var(--color-text)] disabled:opacity-60"
          >
            <X size={14} />
            {t("chat_proposal_dismiss")}
          </button>
        </div>
      ) : (
        <div className="mt-2 text-xs font-bold text-[var(--color-text-muted)]">
          <p>{t(status === "applied" ? "chat_proposal_applied" : "chat_proposal_dismissed")}</p>
          {status === "applied" && skipped > 0 ? (
            <p className="font-medium">{t(skipped === 1 ? "chat_proposal_skipped_one" : "chat_proposal_skipped", { count: skipped })}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
