"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HandCoins, Plus, RotateCw, WifiOff } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useTripMembers } from "@/components/memories/use-trip-members";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { simplifyDebts, summarizeTrip } from "@/lib/expenses/balances";
import { formatCents } from "@/lib/expenses/money";
import { addSettlement, deleteSettlement, loadExpenses, loadSettlements, type ExpenseError, type ExpensesClient } from "@/lib/expenses/sync";
import type { Expense, Settlement, Transfer } from "@/lib/expenses/types";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/use-auth-store";
import { useOfflineStore } from "@/store/use-offline-store";
import { ExpenseEditor } from "./ExpenseEditor";
import { ExpenseList } from "./ExpenseList";
import { BalancesTable, DebtsCard, ExpensesTotals } from "./ExpensesSummary";
import { SettlementHistory } from "./SettlementHistory";
import { ERROR_KEYS, cardClass, personNamer, todayIso } from "./expense-ui";

type ExpensesViewProps = {
  tripId: string;
  /** The trip owner's user id: they may edit or delete anyone's expenses. */
  ownerId: string | null | undefined;
  /** The trip currency, the default of new expenses. */
  currency: string;
  /** A trip not saved yet has no shared expenses. */
  isDraft?: boolean;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; expenses: Expense[]; settlements: Settlement[] }
  | { status: "error"; error: ExpenseError };

const client = supabase as unknown as ExpensesClient;
const LOADING: LoadState = { status: "loading" };

const primaryButton =
  "min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-black text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:pointer-events-none";

/** The Expenses section of a trip: totals, who owes whom, balances, the list and settlements. */
export function ExpensesView({ tripId, ownerId, currency, isDraft = false }: ExpensesViewProps) {
  const { t, lang } = useI18n();
  const userId = useAuthStore((state) => state.user?.id ?? "");
  const isOnline = useOfflineStore((state) => state.isOnline);
  const { members, loading: membersLoading } = useTripMembers(tripId, Boolean(tripId) && !isDraft);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [state, setState] = useState<{ tripId: string; load: LoadState } | null>(null);
  const [editor, setEditor] = useState<{ expense?: Expense } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!tripId || isDraft) return;
    let cancelled = false;
    void Promise.all([loadExpenses(client, tripId), loadSettlements(client, tripId)]).then(([loaded, history]) => {
      if (cancelled) return;
      const error = loaded.error ?? (history.error === "unavailable" ? "unavailable" : undefined);
      setState((current) => {
        // A failed refresh keeps what is already on screen.
        if (error && current?.tripId === tripId && current.load.status === "ready" && error !== "unavailable") return current;
        return { tripId, load: error ? { status: "error", error } : { status: "ready", expenses: loaded.expenses, settlements: history.settlements } };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, isDraft, reloadKey]);

  const load: LoadState = state?.tripId === tripId ? state.load : LOADING;
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
          <ExpenseList expenses={expenses} people={people} onOpen={(expense) => setEditor({ expense })} />
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
          key={editor.expense?.id ?? "new"}
          client={client}
          tripId={tripId}
          currency={currency}
          members={members}
          currentUserId={userId}
          expense={editor.expense}
          canEdit={!editor.expense || canEditRow(editor.expense.createdBy)}
          online={isOnline}
          onSaved={reload}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
