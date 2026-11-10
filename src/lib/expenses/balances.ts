import type { Expense, Settlement, Transfer } from "./types";

export type PersonBalance = {
  userId: string;
  paidCents: number;
  shareCents: number;
  /** Settlements this person paid to others. */
  settledOutCents: number;
  /** Settlements this person received. */
  settledInCents: number;
  /** paid - share + settledOut - settledIn: positive = others owe them, negative = they owe. */
  balanceCents: number;
};

export type CurrencySummary = { totalCents: number; people: PersonBalance[] };

/** Currency code -> summary. Currencies are never converted or mixed. */
export type TripSummary = Record<string, CurrencySummary>;

const emptyPerson = (userId: string): PersonBalance => ({ userId, paidCents: 0, shareCents: 0, settledOutCents: 0, settledInCents: 0, balanceCents: 0 });

/**
 * Totals, paid, share and balance per person for each currency. Every member is listed (members
 * first in `memberIds` order), plus former members found in the data, sorted by id.
 */
export function summarizeTrip(expenses: Expense[], settlements: Settlement[], memberIds: string[]): TripSummary {
  const byCurrency = new Map<string, { totalCents: number; people: Map<string, PersonBalance> }>();
  const person = (currency: string, userId: string) => {
    let entry = byCurrency.get(currency);
    if (!entry) {
      entry = { totalCents: 0, people: new Map() };
      byCurrency.set(currency, entry);
    }
    let row = entry.people.get(userId);
    if (!row) {
      row = emptyPerson(userId);
      entry.people.set(userId, row);
    }
    return row;
  };

  for (const expense of expenses) {
    for (const payer of expense.payers) person(expense.currency, payer.userId).paidCents += payer.paidCents;
    byCurrency.get(expense.currency)!.totalCents += expense.amountCents;
    for (const split of expense.splits) person(expense.currency, split.userId).shareCents += split.shareCents;
  }
  for (const settlement of settlements) {
    person(settlement.currency, settlement.fromUser).settledOutCents += settlement.amountCents;
    person(settlement.currency, settlement.toUser).settledInCents += settlement.amountCents;
  }

  const summary: TripSummary = {};
  const members = [...new Set(memberIds)];
  const memberSet = new Set(members);
  for (const [currency, entry] of byCurrency) {
    const others = [...entry.people.keys()].filter((id) => !memberSet.has(id)).sort();
    const people = [...members, ...others].map((userId) => {
      const row = entry.people.get(userId) ?? emptyPerson(userId);
      return { ...row, balanceCents: row.paidCents - row.shareCents + row.settledOutCents - row.settledInCents };
    });
    summary[currency] = { totalCents: entry.totalCents, people };
  }
  return summary;
}

const byUserId = (a: { userId: string }, b: { userId: string }) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

/**
 * Fewest-ish payments that settle everyone: repeatedly the largest debtor pays the largest creditor
 * (ties by user id), at most n-1 transfers.
 */
export function simplifyDebts(people: { userId: string; balanceCents: number }[], currency: string): Transfer[] {
  const creditors = people.filter((p) => p.balanceCents > 0).map((p) => ({ userId: p.userId, left: p.balanceCents }));
  const debtors = people.filter((p) => p.balanceCents < 0).map((p) => ({ userId: p.userId, left: -p.balanceCents }));
  const largest = (list: { userId: string; left: number }[]) => [...list].sort((a, b) => b.left - a.left || byUserId(a, b))[0];
  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = largest(creditors);
    const debtor = largest(debtors);
    const amountCents = Math.min(creditor.left, debtor.left);
    transfers.push({ from: debtor.userId, to: creditor.userId, amountCents, currency });
    creditor.left -= amountCents;
    debtor.left -= amountCents;
    if (creditor.left === 0) creditors.splice(creditors.indexOf(creditor), 1);
    if (debtor.left === 0) debtors.splice(debtors.indexOf(debtor), 1);
  }
  return transfers;
}
