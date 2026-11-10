import type { ExpensePayer, ExpenseSplit, SplitMethod } from "./types";

export type SplitInput = {
  method: SplitMethod;
  amountCents: number;
  /** Who shares the expense, in display order; excluded people are simply left out. */
  participantIds: string[];
  /** exact: cents per participant (missing = 0). */
  exactCents?: Record<string, number>;
  /** percent: basis points per participant (10000 = 100 %, missing = 0). */
  percentBp?: Record<string, number>;
  payerId?: string;
};

export type SplitError = "no_participants" | "invalid_amount" | "sum_mismatch" | "percent_mismatch" | "individual_needs_one";

export type SplitResult = { ok: true; splits: ExpenseSplit[] } | { ok: false; error: SplitError };

const ZERO = BigInt(0);
const ONE = BigInt(1);
const FULL = BigInt(10000);

const isCents = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Equal parts; the remainder cents go one each to the first participants. */
function equalSplits(amountCents: number, ids: string[]): ExpenseSplit[] {
  const base = Math.floor(amountCents / ids.length);
  const remainder = amountCents - base * ids.length;
  return ids.map((userId, index) => ({ userId, shareCents: base + (index < remainder ? 1 : 0) }));
}

/** Shares as typed; they must add up to the amount. People with 0 are dropped. */
function exactSplits(amountCents: number, ids: string[], exact: Record<string, number>): SplitResult {
  const shares = ids.map((userId) => ({ userId, shareCents: exact[userId] ?? 0 }));
  if (shares.some((split) => !isCents(split.shareCents))) return { ok: false, error: "invalid_amount" };
  if (shares.reduce((sum, split) => sum + split.shareCents, 0) !== amountCents) return { ok: false, error: "sum_mismatch" };
  return { ok: true, splits: shares.filter((split) => split.shareCents > 0) };
}

/**
 * Percent shares rounded down, then the leftover cents by largest fractional remainder (ties by
 * participant order). BigInt keeps large amounts exact. People with 0 % are dropped.
 */
function percentSplits(amountCents: number, ids: string[], percent: Record<string, number>): SplitResult {
  const parts = ids.map((userId) => ({ userId, bp: percent[userId] ?? 0 }));
  if (parts.some((part) => !Number.isInteger(part.bp) || part.bp < 0)) return { ok: false, error: "percent_mismatch" };
  if (parts.reduce((sum, part) => sum + part.bp, 0) !== 10000) return { ok: false, error: "percent_mismatch" };
  const amount = BigInt(amountCents);
  const raw = parts
    .filter((part) => part.bp > 0)
    .map((part, index) => {
      const scaled = amount * BigInt(part.bp);
      return { ...part, index, share: scaled / FULL, remainder: scaled % FULL };
    });
  let leftover = amount - raw.reduce((sum, part) => sum + part.share, ZERO);
  const byRemainder = [...raw].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const part of byRemainder) {
    if (leftover === ZERO) break;
    part.share += ONE;
    leftover -= ONE;
  }
  return { ok: true, splits: raw.map((part) => ({ userId: part.userId, shareCents: Number(part.share), percentBp: part.bp })) };
}

/** Splits an expense among its participants; every ok result adds up exactly to the amount. */
export function computeSplits(input: SplitInput): SplitResult {
  const ids = [...new Set(input.participantIds)];
  if (ids.length === 0) return { ok: false, error: "no_participants" };
  if (!isCents(input.amountCents) || input.amountCents === 0) return { ok: false, error: "invalid_amount" };
  switch (input.method) {
    case "equal":
      return { ok: true, splits: equalSplits(input.amountCents, ids) };
    case "exact":
      return exactSplits(input.amountCents, ids, input.exactCents ?? {});
    case "percent":
      return percentSplits(input.amountCents, ids, input.percentBp ?? {});
    case "individual":
      if (ids.length !== 1) return { ok: false, error: "individual_needs_one" };
      return { ok: true, splits: [{ userId: ids[0], shareCents: input.amountCents }] };
  }
}

/** How the amount is divided among several payers: equal parts, or the amounts each one paid. */
export type PayerMode = "equal" | "exact";

export type PayersInput = {
  amountCents: number;
  /** Who paid, in display order. */
  payerIds: string[];
  mode: PayerMode;
  /** exact: cents per payer (missing = 0). */
  exactCents?: Record<string, number>;
};

export type PayersResult = { ok: true; payers: ExpensePayer[] } | { ok: false; error: SplitError };

/** Who paid what; every ok result adds up exactly to the amount, with no payer at 0. */
export function computePayers(input: PayersInput): PayersResult {
  const result = computeSplits({
    method: input.mode,
    amountCents: input.amountCents,
    participantIds: input.payerIds,
    exactCents: input.exactCents,
  });
  if (!result.ok) return result;
  return { ok: true, payers: result.splits.filter((split) => split.shareCents > 0).map((split) => ({ userId: split.userId, paidCents: split.shareCents })) };
}
