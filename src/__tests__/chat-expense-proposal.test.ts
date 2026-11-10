import { describe, expect, it } from "vitest";
import { normalizeExpenseProposal, type ExpenseProposalContext } from "@/lib/chat/expense-proposal";

// S1-S2 (odd/tasks/tachi-expenses.md): Tachi turns "jacke y yo pagamos el hotel, marly nos debe
// 100 euros" into an expense proposal. The model answers in plain amounts; the server converts
// them to cents and recomputes payers and splits, so only an exact, member-only expense survives.
const ctx: ExpenseProposalContext = {
  people: [
    { userId: "hernan", name: "Hernán", isYou: true },
    { userId: "jack", name: "Jack", isYou: false },
    { userId: "marly", name: "Marly", isYou: false },
  ],
  currency: "EUR",
  today: "2026-11-10",
  activityIds: ["hotel-checkin"],
};

const hotel = {
  title: "Hotel",
  amount: 300,
  category: "lodging",
  payers: [{ userId: "hernan" }, { userId: "jack" }],
  split: { method: "equal", participants: ["hernan", "jack", "marly"] },
};

describe("normalizeExpenseProposal", () => {
  it("pins the example: Jack and I paid the 300 € hotel, Marly owes us 100 €", () => {
    expect(normalizeExpenseProposal(hotel, ctx)).toEqual({
      title: "Hotel",
      amountCents: 30000,
      currency: "EUR",
      spentOn: "2026-11-10",
      category: "lodging",
      activityId: null,
      payers: [
        { userId: "hernan", paidCents: 15000 },
        { userId: "jack", paidCents: 15000 },
      ],
      splitMethod: "equal",
      splits: [
        { userId: "hernan", shareCents: 10000 },
        { userId: "jack", shareCents: 10000 },
        { userId: "marly", shareCents: 10000 },
      ],
      notes: null,
    });
  });

  it("takes what each payer paid and an exact split in decimal amounts", () => {
    const result = normalizeExpenseProposal(
      {
        ...hotel,
        amount: 250.5,
        payers: [{ userId: "hernan", amount: 200 }, { userId: "jack", amount: 50.5 }],
        split: { method: "exact", participants: ["hernan", "jack", "marly"], amounts: { hernan: 75.25, jack: 75.25, marly: 100 } },
      },
      ctx,
    );
    expect(result?.payers).toEqual([
      { userId: "hernan", paidCents: 20000 },
      { userId: "jack", paidCents: 5050 },
    ]);
    expect(result?.splitMethod).toBe("exact");
    expect(result?.splits).toEqual([
      { userId: "hernan", shareCents: 7525 },
      { userId: "jack", shareCents: 7525 },
      { userId: "marly", shareCents: 10000 },
    ]);
  });

  it("converts percentages to basis points", () => {
    const result = normalizeExpenseProposal({ ...hotel, split: { method: "percent", participants: ["hernan", "marly"], percents: { hernan: 60, marly: 40 } } }, ctx);
    expect(result?.splits).toEqual([
      { userId: "hernan", shareCents: 18000, percentBp: 6000 },
      { userId: "marly", shareCents: 12000, percentBp: 4000 },
    ]);
  });

  it("drops a proposal whose amounts do not add up", () => {
    expect(normalizeExpenseProposal({ ...hotel, payers: [{ userId: "hernan", amount: 200 }, { userId: "jack", amount: 50 }] }, ctx)).toBeNull();
    expect(normalizeExpenseProposal({ ...hotel, payers: [{ userId: "hernan", amount: 300 }, { userId: "jack" }] }, ctx)).toBeNull();
    expect(
      normalizeExpenseProposal({ ...hotel, split: { method: "exact", participants: ["hernan", "marly"], amounts: { hernan: 100, marly: 100 } } }, ctx),
    ).toBeNull();
  });

  it("never invents an amount or a person", () => {
    expect(normalizeExpenseProposal({ ...hotel, title: "  " }, ctx)).toBeNull();
    expect(normalizeExpenseProposal({ ...hotel, amount: undefined }, ctx)).toBeNull();
    expect(normalizeExpenseProposal({ ...hotel, amount: 0 }, ctx)).toBeNull();
    expect(normalizeExpenseProposal({ ...hotel, payers: [] }, ctx)).toBeNull();
    expect(normalizeExpenseProposal({ ...hotel, payers: [{ userId: "stranger" }] }, ctx)).toBeNull();
    expect(normalizeExpenseProposal({ ...hotel, split: { method: "equal", participants: ["hernan", "stranger"] } }, ctx)).toBeNull();
    expect(normalizeExpenseProposal({ ...hotel, payers: [{ userId: "hernan" }, { userId: "hernan" }] }, ctx)).toBeNull();
  });

  it("splits among everyone when the participants are left out", () => {
    const result = normalizeExpenseProposal({ ...hotel, split: { method: "equal" } }, ctx);
    expect(result?.splits.map((split) => split.userId)).toEqual(["hernan", "jack", "marly"]);
  });

  it("falls back to safe defaults for the optional fields and keeps only a known activity", () => {
    const result = normalizeExpenseProposal(
      { ...hotel, currency: "usd", spentOn: "yesterday", category: "spa", activityId: "ghost", notes: "  Booking 123  " },
      ctx,
    );
    expect(result).toMatchObject({ title: "Hotel", currency: "EUR", spentOn: "2026-11-10", category: "other", activityId: null, notes: "Booking 123" });
    expect(normalizeExpenseProposal({ ...hotel, currency: "USD", spentOn: "2026-11-08", activityId: "hotel-checkin" }, ctx)).toMatchObject({
      currency: "USD",
      spentOn: "2026-11-08",
      activityId: "hotel-checkin",
    });
  });

  it("uses the currency's own decimals", () => {
    expect(normalizeExpenseProposal({ ...hotel, amount: 3000, currency: "JPY" }, ctx)?.amountCents).toBe(3000);
  });
});
