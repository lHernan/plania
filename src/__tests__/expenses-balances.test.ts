import { describe, expect, it } from "vitest";
import { simplifyDebts, summarizeTrip } from "@/lib/expenses/balances";
import { formatCents } from "@/lib/expenses/money";
import { computeSplits } from "@/lib/expenses/splits";
import type { Expense, ExpensePayer, Settlement, SplitMethod } from "@/lib/expenses/types";

const plain = (text: string) => text.replace(/ | /g, " ");

let seq = 0;
function expense(paidBy: string | ExpensePayer[], amountCents: number, participantIds: string[], extra: Partial<Expense> = {}): Expense {
  const method: SplitMethod = extra.splitMethod ?? "equal";
  const result = computeSplits({ method, amountCents, participantIds });
  if (!result.ok) throw new Error(result.error);
  seq += 1;
  return {
    id: `e${seq}`,
    tripId: "t1",
    activityId: null,
    title: "Expense",
    amountCents,
    currency: "EUR",
    spentOn: "2026-11-10",
    category: "other",
    payers: typeof paidBy === "string" ? [{ userId: paidBy, paidCents: amountCents }] : paidBy,
    splitMethod: method,
    notes: null,
    receiptPath: null,
    createdBy: typeof paidBy === "string" ? paidBy : paidBy[0].userId,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
    splits: result.splits,
    ...extra,
  };
}

function settlement(fromUser: string, toUser: string, amountCents: number, currency = "EUR"): Settlement {
  seq += 1;
  return { id: `s${seq}`, tripId: "t1", fromUser, toUser, amountCents, currency, settledOn: "2026-11-11", note: null, createdBy: fromUser, createdAt: "2026-11-11T10:00:00Z" };
}

const balances = (summary: ReturnType<typeof summarizeTrip>, currency = "EUR") =>
  Object.fromEntries((summary[currency]?.people ?? []).map((person) => [person.userId, person.balanceCents]));
const sumBalances = (summary: ReturnType<typeof summarizeTrip>, currency = "EUR") =>
  (summary[currency]?.people ?? []).reduce((sum, person) => sum + person.balanceCents, 0);

const MEMBERS = ["hernan", "wife", "p3", "p4", "p5"];
const lodging = () => expense("hernan", 50000, ["hernan", "wife", "p3"], { category: "lodging" });

describe("summarizeTrip", () => {
  it("credits every payer with what they paid: Jack and I paid the hotel, Marly owes us 100 €", () => {
    const hotel = expense([{ userId: "hernan", paidCents: 15000 }, { userId: "jack", paidCents: 15000 }], 30000, ["hernan", "jack", "marly"], { category: "lodging" });
    const summary = summarizeTrip([hotel], [], ["hernan", "jack", "marly"]);
    expect(summary.EUR.totalCents).toBe(30000);
    expect(summary.EUR.people.map((p) => [p.userId, p.paidCents, p.shareCents, p.balanceCents])).toEqual([
      ["hernan", 15000, 10000, 5000],
      ["jack", 15000, 10000, 5000],
      ["marly", 0, 10000, -10000],
    ]);
    expect(simplifyDebts(summary.EUR.people, "EUR")).toEqual([
      { from: "marly", to: "hernan", amountCents: 5000, currency: "EUR" },
      { from: "marly", to: "jack", amountCents: 5000, currency: "EUR" },
    ]);
  });

  it("pins the lodging example: Hernán pays 500 € split among 3", () => {
    const summary = summarizeTrip([lodging()], [], MEMBERS);
    expect(summary.EUR.totalCents).toBe(50000);
    expect(balances(summary)).toEqual({ hernan: 33333, wife: -16667, p3: -16666, p4: 0, p5: 0 });
    const hernan = summary.EUR.people[0];
    expect(hernan).toEqual({ userId: "hernan", paidCents: 50000, shareCents: 16667, settledOutCents: 0, settledInCents: 0, balanceCents: 33333 });
    const row = [formatCents(hernan.paidCents, "EUR", "es-ES"), formatCents(hernan.shareCents, "EUR", "es-ES"), formatCents(hernan.balanceCents, "EUR", "es-ES", { signed: true })].map(plain);
    expect(row).toEqual(["500,00 €", "166,67 €", "+333,33 €"]);
  });

  it("adds a dinner paid by p3 split among 5 and keeps balances summing to 0", () => {
    const summary = summarizeTrip([lodging(), expense("p3", 10000, MEMBERS, { category: "food" })], [], MEMBERS);
    expect(summary.EUR.totalCents).toBe(60000);
    expect(balances(summary)).toEqual({ hernan: 31333, wife: -18667, p3: -16666 + 8000, p4: -2000, p5: -2000 });
    expect(sumBalances(summary)).toBe(0);
  });

  it("a settlement wife -> Hernán of 166,67 € brings the wife to 0", () => {
    const summary = summarizeTrip([lodging()], [settlement("wife", "hernan", 16667)], MEMBERS);
    const byId = Object.fromEntries(summary.EUR.people.map((person) => [person.userId, person]));
    expect(byId.wife.balanceCents).toBe(0);
    expect(byId.wife.settledOutCents).toBe(16667);
    expect(byId.hernan.settledInCents).toBe(16667);
    expect(byId.hernan.balanceCents).toBe(16666);
    expect(summary.EUR.totalCents).toBe(50000);
    expect(sumBalances(summary)).toBe(0);
  });

  it("keeps every currency separate", () => {
    const summary = summarizeTrip(
      [lodging(), expense("wife", 3000, ["hernan", "wife"], { currency: "USD" })],
      [settlement("p3", "hernan", 1000, "USD")],
      MEMBERS,
    );
    expect(Object.keys(summary).sort()).toEqual(["EUR", "USD"]);
    expect(summary.EUR.totalCents).toBe(50000);
    expect(summary.USD.totalCents).toBe(3000);
    expect(balances(summary, "EUR")).toEqual({ hernan: 33333, wife: -16667, p3: -16666, p4: 0, p5: 0 });
    expect(balances(summary, "USD")).toEqual({ hernan: -1500 - 1000, wife: 1500, p3: 1000, p4: 0, p5: 0 });
    expect(sumBalances(summary, "USD")).toBe(0);
  });

  it("includes every member, then former members by id", () => {
    const summary = summarizeTrip([expense("zed", 900, ["hernan", "zed", "abe"])], [], ["wife", "hernan"]);
    expect(summary.EUR.people.map((person) => person.userId)).toEqual(["wife", "hernan", "abe", "zed"]);
    expect(balances(summary)).toEqual({ wife: 0, hernan: -300, abe: -300, zed: 600 });
  });

  it("returns no currency when there is nothing recorded", () => {
    expect(summarizeTrip([], [], MEMBERS)).toEqual({});
  });
});

describe("simplifyDebts", () => {
  const settle = (people: { userId: string; balanceCents: number }[], transfers: ReturnType<typeof simplifyDebts>) => {
    const left = new Map(people.map((person) => [person.userId, person.balanceCents]));
    for (const transfer of transfers) {
      left.set(transfer.from, left.get(transfer.from)! + transfer.amountCents);
      left.set(transfer.to, left.get(transfer.to)! - transfer.amountCents);
    }
    return [...left.values()];
  };

  it("matches the largest debtor with the largest creditor", () => {
    const people = [
      { userId: "hernan", balanceCents: 33333 },
      { userId: "wife", balanceCents: -16667 },
      { userId: "p3", balanceCents: -16666 },
    ];
    expect(simplifyDebts(people, "EUR")).toEqual([
      { from: "wife", to: "hernan", amountCents: 16667, currency: "EUR" },
      { from: "p3", to: "hernan", amountCents: 16666, currency: "EUR" },
    ]);
  });

  it("settles everyone exactly with at most n-1 transfers", () => {
    const people = [
      { userId: "a", balanceCents: 31333 },
      { userId: "b", balanceCents: -18667 },
      { userId: "c", balanceCents: -8666 },
      { userId: "d", balanceCents: -2000 },
      { userId: "e", balanceCents: -2000 },
      { userId: "f", balanceCents: 0 },
    ];
    const transfers = simplifyDebts(people, "EUR");
    expect(transfers.length).toBeLessThanOrEqual(people.length - 1);
    expect(transfers.every((transfer) => transfer.amountCents > 0)).toBe(true);
    expect(settle(people, transfers).every((balance) => balance === 0)).toBe(true);
  });

  it("is deterministic: ties go by user id regardless of input order", () => {
    const people = [
      { userId: "c", balanceCents: -500 },
      { userId: "b", balanceCents: 500 },
      { userId: "a", balanceCents: -500 },
      { userId: "d", balanceCents: 500 },
    ];
    const expected = [
      { from: "a", to: "b", amountCents: 500, currency: "USD" },
      { from: "c", to: "d", amountCents: 500, currency: "USD" },
    ];
    expect(simplifyDebts(people, "USD")).toEqual(expected);
    expect(simplifyDebts([...people].reverse(), "USD")).toEqual(expected);
  });

  it("returns nothing when everyone is even", () => {
    expect(simplifyDebts([{ userId: "a", balanceCents: 0 }], "EUR")).toEqual([]);
  });
});
