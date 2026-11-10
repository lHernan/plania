import { currencyDecimals } from "@/lib/expenses/money";
import { computePayers, computeSplits } from "@/lib/expenses/splits";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type SplitMethod } from "@/lib/expenses/types";
import type { ChatExpensePayload } from "@/lib/types";

/** What the server knows when it checks an expense Tachi proposes. */
export type ExpenseProposalContext = {
  /** The trip members; `isYou` marks the person talking to Tachi. */
  people: { userId: string; name: string; isYou: boolean }[];
  /** The trip currency, used when the model gives none. */
  currency: string;
  /** yyyy-MM-dd, used when the model gives no date. */
  today: string;
  activityIds: string[];
};

const SPLIT_METHODS: SplitMethod[] = ["equal", "exact", "percent", "individual"];

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A plain amount ("150.5") in minor units of the currency; null unless finite and positive. */
function toMinor(value: unknown, decimals: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 10 ** decimals);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function isIsoDate(value: unknown): value is string {
  // Round-trips, so an impossible day such as 2026-02-30 is rejected as Postgres would.
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Member ids in the given order; null when one is unknown or repeated. */
function memberIds(values: unknown[], members: Set<string>): string[] | null {
  const ids = values.map((value) => (typeof value === "string" ? value : ""));
  if (ids.some((id) => !members.has(id)) || new Set(ids).size !== ids.length) return null;
  return ids;
}

/**
 * The model's expense in plain amounts, as a proposal in cents: payers and splits are recomputed
 * with the same rules as the manual form, so anything that does not add up, or names someone who
 * is not a member, is dropped (null) instead of guessed.
 */
export function normalizeExpenseProposal(value: unknown, context: ExpenseProposalContext): ChatExpensePayload | null {
  const source = record(value);
  if (!source) return null;
  const title = text(source.title, 200);
  if (!title) return null;

  const currency = typeof source.currency === "string" && /^[A-Z]{3}$/.test(source.currency) ? source.currency : context.currency;
  const decimals = currencyDecimals(currency);
  const amountCents = toMinor(source.amount, decimals);
  if (!amountCents) return null;
  const members = new Set(context.people.map((person) => person.userId));

  // Payers: all with an amount (what each one paid) or none (equal parts).
  const rawPayers = Array.isArray(source.payers) ? source.payers.map(record) : [];
  if (rawPayers.length === 0 || rawPayers.some((payer) => !payer)) return null;
  const payerIds = memberIds(rawPayers.map((payer) => payer!.userId), members);
  if (!payerIds) return null;
  const payerAmounts = rawPayers.map((payer) => (payer!.amount === undefined || payer!.amount === null ? undefined : toMinor(payer!.amount, decimals)));
  const typed = payerAmounts.filter((amount) => amount !== undefined);
  if (typed.length > 0 && (typed.length !== payerAmounts.length || typed.some((amount) => amount === null))) return null;
  const paid = computePayers({
    amountCents,
    payerIds,
    mode: typed.length > 0 ? "exact" : "equal",
    exactCents: Object.fromEntries(payerIds.map((id, index) => [id, payerAmounts[index] ?? 0])),
  });
  if (!paid.ok) return null;

  // Split: everyone when the participants are left out.
  const split = record(source.split) ?? {};
  const method = SPLIT_METHODS.includes(split.method as SplitMethod) ? (split.method as SplitMethod) : "equal";
  const participantIds =
    Array.isArray(split.participants) && split.participants.length > 0 ? memberIds(split.participants, members) : context.people.map((person) => person.userId);
  if (!participantIds) return null;
  const amounts = record(split.amounts) ?? {};
  const percents = record(split.percents) ?? {};
  const exactCents: Record<string, number> = {};
  const percentBp: Record<string, number> = {};
  for (const id of participantIds) {
    if (method === "exact") exactCents[id] = amounts[id] === undefined ? 0 : toMinor(amounts[id], decimals) ?? Number.NaN;
    if (method === "percent") percentBp[id] = typeof percents[id] === "number" && Number.isFinite(percents[id]) ? Math.round((percents[id] as number) * 100) : 0;
  }
  const splits = computeSplits({ method, amountCents, participantIds, exactCents, percentBp });
  if (!splits.ok) return null;

  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(source.category as string) ? (source.category as ExpenseCategory) : "other";
  const activityId = typeof source.activityId === "string" && context.activityIds.includes(source.activityId) ? source.activityId : null;
  return {
    title,
    amountCents,
    currency,
    spentOn: isIsoDate(source.spentOn) ? source.spentOn : context.today,
    category,
    activityId,
    payers: paid.payers,
    splitMethod: method,
    splits: splits.splits,
    notes: text(source.notes, 2000) || null,
  };
}
