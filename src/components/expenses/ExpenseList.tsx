"use client";

import { Link2, Paperclip } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemberAvatar } from "@/components/members/MemberAvatar";
import { formatCents } from "@/lib/expenses/money";
import type { Expense } from "@/lib/expenses/types";
import { CATEGORY_ICONS, CATEGORY_KEYS, cardClass, formatDay, sectionTitleClass, type PersonNamer } from "./expense-ui";

/** Newest day first; inside a day, the latest recorded first. */
export function sortExpenses(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => (a.spentOn === b.spentOn ? b.createdAt.localeCompare(a.createdAt) : b.spentOn.localeCompare(a.spentOn)));
}

/** The trip's expenses grouped by date; tapping one opens it. */
export function ExpenseList({
  expenses,
  people,
  onOpen,
  activityTitle = () => undefined,
}: {
  expenses: Expense[];
  people: PersonNamer;
  onOpen: (expense: Expense) => void;
  /** The title of a linked activity still in the trip. */
  activityTitle?: (activityId: string) => string | undefined;
}) {
  const { t, lang } = useI18n();
  const groups: { day: string; items: Expense[] }[] = [];
  for (const expense of sortExpenses(expenses)) {
    const last = groups[groups.length - 1];
    if (last?.day === expense.spentOn) last.items.push(expense);
    else groups.push({ day: expense.spentOn, items: [expense] });
  }

  return (
    <section className="space-y-3" aria-labelledby="expenses-list-title">
      <h3 id="expenses-list-title" className={sectionTitleClass}>{t("expenses_list_title")}</h3>
      {groups.map((group) => (
        <div key={group.day} className="space-y-2">
          <p className="px-1 text-[11px] font-bold capitalize text-[var(--color-text-secondary)]">{formatDay(group.day, lang)}</p>
          <ul className={`${cardClass} divide-y divide-[var(--color-border)] p-0`}>
            {group.items.map((expense) => {
              const Icon = CATEGORY_ICONS[expense.category];
              const split =
                expense.splits.length === 1
                  ? t("expenses_split_only", { name: people.name(expense.splits[0].userId) })
                  : t("expenses_split_among", { count: expense.splits.length });
              const linked = expense.activityId ? activityTitle(expense.activityId) : undefined;
              return (
                <li key={expense.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(expense)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]/40 first:rounded-t-2xl last:rounded-b-2xl"
                  >
                    <span
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                      title={t(CATEGORY_KEYS[expense.category])}
                    >
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-[var(--color-text)]">{expense.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                        <MemberAvatar member={people.member(expense.paidBy)} size="xs" />
                        <span className="truncate">
                          {t("expenses_paid_by", { name: people.name(expense.paidBy) })} · {split}
                        </span>
                        {expense.receiptPath && (
                          <>
                            <Paperclip size={12} aria-hidden="true" className="shrink-0" />
                            <span className="sr-only">{t("expenses_receipt_attached")}</span>
                          </>
                        )}
                      </span>
                      {linked && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--color-primary)]">
                          <Link2 size={12} aria-hidden="true" className="shrink-0" />
                          <span className="sr-only">{t("expenses_linked_activity")}</span>
                          <span className="truncate">{linked}</span>
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm font-black tabular-nums text-[var(--color-text)]">
                      {formatCents(expense.amountCents, expense.currency, lang)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
