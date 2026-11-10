"use client";

import { ArrowRight, Trash2 } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { formatCents } from "@/lib/expenses/money";
import type { Settlement } from "@/lib/expenses/types";
import { cardClass, formatDay, sectionTitleClass, type PersonNamer } from "./expense-ui";

/** The recorded payments, newest first; their creator or the trip owner can delete one. */
export function SettlementHistory({
  settlements,
  people,
  canDelete,
  onDelete,
}: {
  settlements: Settlement[];
  people: PersonNamer;
  canDelete: (settlement: Settlement) => boolean;
  onDelete: (settlement: Settlement) => void;
}) {
  const { t, lang } = useI18n();
  const sorted = [...settlements].sort((a, b) => (a.settledOn === b.settledOn ? b.createdAt.localeCompare(a.createdAt) : b.settledOn.localeCompare(a.settledOn)));
  return (
    <section className={`${cardClass} space-y-3`} aria-labelledby="expenses-history-title">
      <h3 id="expenses-history-title" className={sectionTitleClass}>{t("expenses_history_title")}</h3>
      <ul className="divide-y divide-[var(--color-border)]">
        {sorted.map((settlement) => (
          <li key={settlement.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="inline-flex flex-wrap items-center gap-1.5 text-sm font-bold text-[var(--color-text)]">
                <span>{people.name(settlement.fromUser)}</span>{" "}
                <ArrowRight size={14} aria-hidden="true" className="text-[var(--color-text-muted)]" />
                <span className="sr-only">→</span>{" "}
                <span>{people.name(settlement.toUser)}</span>{" "}
                <span className="tabular-nums">{formatCents(settlement.amountCents, settlement.currency, lang)}</span>
              </p>
              <p className="text-[11px] font-medium capitalize text-[var(--color-text-muted)]">
                {formatDay(settlement.settledOn, lang)}
                {settlement.note ? ` · ${settlement.note}` : ""}
              </p>
            </div>
            {canDelete(settlement) && (
              <button
                type="button"
                onClick={() => onDelete(settlement)}
                aria-label={t("expenses_settlement_delete")}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)] disabled:opacity-50"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
