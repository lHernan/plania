"use client";

import { ArrowRight, Check } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import type { TripSummary } from "@/lib/expenses/balances";
import { formatCents } from "@/lib/expenses/money";
import type { Transfer } from "@/lib/expenses/types";
import { balanceTone, cardClass, sectionTitleClass, type PersonNamer } from "./expense-ui";

/** Total spent and the current user's paid and balance, one discreet block per currency. */
export function ExpensesTotals({ summary, currentUserId }: { summary: TripSummary; currentUserId: string }) {
  const { t, lang } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(summary).map(([currency, block]) => {
        const me = block.people.find((person) => person.userId === currentUserId);
        const balance = me?.balanceCents ?? 0;
        return (
          <div key={currency} className={`${cardClass} flex flex-wrap items-end justify-between gap-4`}>
            <div>
              <p className={sectionTitleClass}>{t("expenses_total")}</p>
              <p data-testid="expenses-total" className="mt-1 text-2xl font-black tabular-nums text-[var(--color-text)]">
                {formatCents(block.totalCents, currency, lang)}
              </p>
            </div>
            <dl className="flex gap-5 text-right">
              <div>
                <dt className="text-[11px] font-semibold text-[var(--color-text-muted)]">{t("expenses_you_paid")}</dt>
                <dd className="text-sm font-bold tabular-nums text-[var(--color-text)]">{formatCents(me?.paidCents ?? 0, currency, lang)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold text-[var(--color-text-muted)]">{t("expenses_your_balance")}</dt>
                <dd className={`text-sm font-bold tabular-nums ${balanceTone(balance)}`}>
                  {formatCents(balance, currency, lang, { signed: true })}
                  <span className="block text-[10px] font-semibold text-[var(--color-text-muted)]">
                    {t(balance > 0 ? "expenses_balance_owed" : balance < 0 ? "expenses_balance_owes" : "expenses_balance_square")}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/** The simplified payments that settle the trip; any member can record one as done. */
export function DebtsCard({
  transfers,
  people,
  canWrite,
  onSettle,
}: {
  transfers: Transfer[];
  people: PersonNamer;
  canWrite: boolean;
  onSettle: (transfer: Transfer) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <section className={`${cardClass} space-y-3`} aria-labelledby="expenses-debts-title">
      <h3 id="expenses-debts-title" className={sectionTitleClass}>{t("expenses_debts_title")}</h3>
      {transfers.length === 0 ? (
        <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]">
          <Check size={16} aria-hidden="true" className="text-[var(--color-success)]" />
          {t("expenses_debts_none")}
        </p>
      ) : (
        <ul aria-label={t("expenses_debts_title")} className="divide-y divide-[var(--color-border)]">
          {transfers.map((transfer) => {
            // Settlements are only between current members (a database rule).
            const settleable = people.isMember(transfer.from) && people.isMember(transfer.to);
            return (
              <li key={`${transfer.currency}-${transfer.from}-${transfer.to}`} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--color-text)]">
                  <span>{people.name(transfer.from)}</span>{" "}
                  <ArrowRight size={14} aria-hidden="true" className="text-[var(--color-text-muted)]" />
                  <span className="sr-only">→</span>{" "}
                  <span>{people.name(transfer.to)}</span>{" "}
                  <span className="ml-1 tabular-nums">{formatCents(transfer.amountCents, transfer.currency, lang)}</span>
                </span>
                {settleable ? (
                  <button
                    type="button"
                    onClick={() => onSettle(transfer)}
                    disabled={!canWrite}
                    className="min-h-11 rounded-xl px-3 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)] disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {t("expenses_settle_action")}
                  </button>
                ) : (
                  <span className="text-[11px] font-medium text-[var(--color-text-muted)]">{t("expenses_settle_former")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Paid / share / balance per person for each currency. */
export function BalancesTable({ summary, people }: { summary: TripSummary; people: PersonNamer }) {
  const { t, lang } = useI18n();
  const currencies = Object.keys(summary);
  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <h3 className={sectionTitleClass}>{t("expenses_balances_title")}</h3>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{t("expenses_balances_legend")}</p>
      </div>
      {currencies.map((currency) => (
        <div key={currency} className="overflow-x-auto">
          <table
            aria-label={currencies.length > 1 ? `${t("expenses_balances_title")} · ${currency}` : t("expenses_balances_title")}
            className="w-full text-sm"
          >
            <thead>
              <tr className="text-left text-[11px] font-semibold text-[var(--color-text-muted)]">
                <th scope="col" className="py-1 pr-2 font-semibold">{t("expenses_col_person")}</th>
                <th scope="col" className="py-1 px-2 text-right font-semibold">{t("expenses_col_paid")}</th>
                <th scope="col" className="py-1 px-2 text-right font-semibold">{t("expenses_col_share")}</th>
                <th scope="col" className="py-1 pl-2 text-right font-semibold">{t("expenses_col_balance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {summary[currency].people.map((person) => (
                <tr key={person.userId}>
                  <th scope="row" className="py-2 pr-2 text-left font-bold text-[var(--color-text)]">{people.name(person.userId)}</th>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--color-text-secondary)]">{formatCents(person.paidCents, currency, lang)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--color-text-secondary)]">{formatCents(person.shareCents, currency, lang)}</td>
                  <td className={`py-2 pl-2 text-right font-bold tabular-nums ${balanceTone(person.balanceCents)}`}>
                    {formatCents(person.balanceCents, currency, lang, { signed: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
