"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HandCoins, Plus, RotateCw, WifiOff } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useTripMembers } from "@/components/memories/use-trip-members";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useTripExpenses } from "@/hooks/use-trip-expenses";
import { activityOptionGroups, categoryForActivity } from "@/lib/expenses/activity-link";
import { simplifyDebts, summarizeTrip } from "@/lib/expenses/balances";
import { formatCents } from "@/lib/expenses/money";
import { addSettlement, deleteSettlement, type ExpenseError, type ExpensesClient } from "@/lib/expenses/sync";
import type { Expense, ExpenseCategory, Settlement, Transfer } from "@/lib/expenses/types";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { useOfflineStore } from "@/store/use-offline-store";
import { ExpenseEditor } from "./ExpenseEditor";
import { ExpenseList } from "./ExpenseList";
import { BalancesTable, DebtsCard, ExpensesTotals } from "./ExpensesSummary";
import { SettlementHistory } from "./SettlementHistory";
import { ERROR_KEYS, EXPENSE_NEW_PARAM, EXPENSE_OPEN_PARAM, cardClass, personNamer, todayIso } from "./expense-ui";

type ExpensesViewProps = {
  tripId: string;
  /** The trip owner's user id: they may edit or delete anyone's expenses. */
  ownerId: string | null | undefined;
  /** The trip currency, the default of new expenses. */
  currency: string;
  /** A trip not saved yet has no shared expenses. */
  isDraft?: boolean;
};

type EditorState = { expense?: Expense; prefill?: { activityId: string; title: string; category: ExpenseCategory } };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; expenses: Expense[]; settlements: Settlement[] }
  | { status: "error"; error: ExpenseError };

const client = supabase as unknown as ExpensesClient;

const primaryButton =
  "min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-black text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:pointer-events-none";

/** The Expenses section of a trip: totals, who owes whom, balances, the list and settlements. */
export function ExpensesView({ tripId, ownerId, currency, isDraft = false }: ExpensesViewProps) {
  const { t, lang } = useI18n();
  const userId = useAuthStore((state) => state.user?.id ?? "");
  const isOnline = useOfflineStore((state) => state.isOnline);
  const { members, loading: membersLoading } = useTripMembers(tripId, Boolean(tripId) && !isDraft);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, refresh: reload } = useTripExpenses(tripId, Boolean(tripId) && !isDraft);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useMemo<LoadState>(
    () => (!data ? { status: "loading" } : data.error ? { status: "error", error: data.error } : { status: "ready", expenses: data.expenses, settlements: data.settlements }),
    [data],
  );

  // The trip activities an expense can be linked to (only while this trip is the open one).
  const activeTrip = useItineraryStore((store) => store.activeTrip);
  const days = activeTrip?.id === tripId ? activeTrip.days : undefined;
  const activityGroups = useMemo(() => activityOptionGroups(days ?? []), [days]);
  const activityTitles = useMemo(
    () => new Map(activityGroups.flatMap((group) => group.options.map((option) => [option.id, option.activity.title] as const))),
    [activityGroups],
  );

  // ?new=<activity> opens a new expense for it; ?expense=<id> opens that expense. Each once.
  const searchParams = useSearchParams();
  const newFor = searchParams?.get(EXPENSE_NEW_PARAM) ?? null;
  const openId = searchParams?.get(EXPENSE_OPEN_PARAM) ?? null;
  const intent = newFor ? `new:${newFor}` : openId ? `open:${openId}` : null;
  const [handledIntent, setHandledIntent] = useState<string | null>(null);
  if (!intent && handledIntent) setHandledIntent(null);
  if (intent && intent !== handledIntent && load.status === "ready" && !membersLoading) {
    setHandledIntent(intent);
    if (newFor) {
      const activity = activityGroups.flatMap((group) => group.options).find((option) => option.id === newFor)?.activity;
      if (activity) setEditor({ prefill: { activityId: activity.id, title: activity.title, category: categoryForActivity(activity) } });
    } else {
      const expense = load.expenses.find((entry) => entry.id === openId);
      if (expense) setEditor({ expense });
    }
  }
  // The address drops the consumed request, so a reload or going back does not reopen it.
  useEffect(() => {
    if (!handledIntent || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(EXPENSE_NEW_PARAM) && !url.searchParams.has(EXPENSE_OPEN_PARAM)) return;
    url.searchParams.delete(EXPENSE_NEW_PARAM);
    url.searchParams.delete(EXPENSE_OPEN_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [handledIntent]);
  const isOwner = Boolean(userId) && userId === ownerId;
  const canWrite = isOnline;
  const people = personNamer(members, t("expenses_former_member"));
  const memberIds = useMemo(() => members.map((member) => member.userId), [members]);

  const summary = useMemo(
    () => (load.status === "ready" ? summarizeTrip(load.expenses, load.settlements, memberIds) : {}),
    [load, memberIds],
  );
  const transfers = useMemo(
    () => Object.entries(summary).flatMap(([code, block]) => simplifyDebts(block.people, code)),
    [summary],
  );

  const settle = async (transfer: Transfer) => {
    const amount = formatCents(transfer.amountCents, transfer.currency, lang);
    const ok = await confirm({
      message: t("expenses_settle_confirm", { from: people.name(transfer.from), to: people.name(transfer.to), amount }),
      confirmLabel: t("expenses_settle_action"),
    });
    if (!ok) return;
    setActionError(null);
    const { error } = await addSettlement(client, {
      tripId,
      fromUser: transfer.from,
      toUser: transfer.to,
      amountCents: transfer.amountCents,
      currency: transfer.currency,
      settledOn: todayIso(),
    });
    if (error) setActionError(t(ERROR_KEYS[error]));
    reload();
  };

  const removeSettlement = async (settlement: Settlement) => {
    if (!(await confirm({ message: t("expenses_settlement_delete_confirm") }))) return;
    setActionError(null);
    const { error } = await deleteSettlement(client, settlement.id);
    if (error) setActionError(t(ERROR_KEYS[error]));
    reload();
  };

  const canEditRow = (createdBy: string) => Boolean(userId) && (createdBy === userId || isOwner);

  const header = (showAdd: boolean) => (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-black text-[var(--color-text)]">{t("expenses_title")}</h2>
      {showAdd && (
        <button type="button" onClick={() => setEditor({})} disabled={!canWrite || membersLoading} className={primaryButton}>
          <Plus size={18} aria-hidden="true" />
          {t("expenses_add")}
        </button>
      )}
    </div>
  );

  if (isDraft) {
    return (
      <div className="space-y-4">
        {header(false)}
        <p className={`${cardClass} text-sm font-medium text-[var(--color-text-secondary)]`}>{t("expenses_draft")}</p>
      </div>
    );
  }

  const offlineNotice = !isOnline && (
    <p className="flex items-center gap-2 rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-xs font-bold text-[var(--color-warning)]">
      <WifiOff size={14} aria-hidden="true" />
      {t("expenses_offline")}
    </p>
  );

  if (load.status === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        {header(false)}
        {offlineNotice}
        <div className="space-y-3" role="status" aria-label={t("expenses_loading")}>
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-16 animate-pulse rounded-2xl bg-[var(--color-surface)]" />
          ))}
        </div>
      </div>
    );
  }

  if (load.status === "error") {
    const unavailable = load.error === "unavailable";
    return (
      <div className="space-y-4">
        {header(false)}
        {offlineNotice}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
          <HandCoins size={28} aria-hidden="true" className="text-[var(--color-text-muted)]" />
          <p className="text-sm font-black text-[var(--color-text)]">{t(unavailable ? "expenses_unavailable_title" : "expenses_load_failed")}</p>
          {unavailable ? (
            <p className="max-w-sm text-xs text-[var(--color-text-secondary)]">{t("expenses_unavailable_body")}</p>
          ) : (
            <button type="button" onClick={reload} className="min-h-11 inline-flex items-center gap-2 rounded-xl px-4 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]">
              <RotateCw size={14} aria-hidden="true" />
              {t("expenses_retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const { expenses, settlements } = load;

  return (
    <div className="space-y-5">
      {confirmDialog}
      {header(true)}
      {offlineNotice}
      {actionError && (
        <p role="alert" className="rounded-xl bg-[var(--color-danger)]/10 px-3 py-2 text-xs font-bold text-[var(--color-danger)]">{actionError}</p>
      )}

      {expenses.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-[var(--color-primary-subtle)] text-[var(--color-primary)]">
            <HandCoins size={26} aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="text-base font-black text-[var(--color-text)]">{t("expenses_empty_title")}</p>
            <p className="max-w-sm text-sm text-[var(--color-text-secondary)]">{t("expenses_empty_body")}</p>
          </div>
          <button type="button" onClick={() => setEditor({})} disabled={!canWrite || membersLoading} className={primaryButton}>
            <Plus size={18} aria-hidden="true" />
            {t("expenses_add")}
          </button>
        </div>
      ) : (
        <>
          <ExpensesTotals summary={summary} currentUserId={userId} />
          <DebtsCard transfers={transfers} people={people} canWrite={canWrite} onSettle={(transfer) => void settle(transfer)} />
          <ExpenseList expenses={expenses} people={people} onOpen={(expense) => setEditor({ expense })} activityTitle={(id) => activityTitles.get(id)} />
          <BalancesTable summary={summary} people={people} />
        </>
      )}

      {settlements.length > 0 && (
        <SettlementHistory
          settlements={settlements}
          people={people}
          canDelete={(settlement) => canWrite && canEditRow(settlement.createdBy)}
          onDelete={(settlement) => void removeSettlement(settlement)}
        />
      )}

      {editor && (
        <ExpenseEditor
          key={editor.expense?.id ?? `new:${editor.prefill?.activityId ?? ""}`}
          client={client}
          tripId={tripId}
          currency={currency}
          members={members}
          currentUserId={userId}
          expense={editor.expense}
          activityGroups={activityGroups}
          prefill={editor.prefill}
          canEdit={!editor.expense || canEditRow(editor.expense.createdBy)}
          online={isOnline}
          onSaved={reload}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
