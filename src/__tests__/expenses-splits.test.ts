import { describe, expect, it } from "vitest";
import { computePayers, computeSplits, type SplitResult } from "@/lib/expenses/splits";

const shares = (result: SplitResult) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.splits.map((split) => [split.userId, split.shareCents]);
};
const total = (result: SplitResult) => (result.ok ? result.splits.reduce((sum, split) => sum + split.shareCents, 0) : NaN);

describe("computeSplits — common rules", () => {
  it("needs at least one participant", () => {
    expect(computeSplits({ method: "equal", amountCents: 1000, participantIds: [] })).toEqual({ ok: false, error: "no_participants" });
  });

  it("rejects zero, negative and non-integer amounts", () => {
    for (const amountCents of [0, -100, 12.5, Number.NaN]) {
      expect(computeSplits({ method: "equal", amountCents, participantIds: ["a"] })).toEqual({ ok: false, error: "invalid_amount" });
    }
  });

  it("removes duplicate participants", () => {
    expect(shares(computeSplits({ method: "equal", amountCents: 1000, participantIds: ["a", "b", "a"] }))).toEqual([
      ["a", 500],
      ["b", 500],
    ]);
  });
});

describe("computeSplits — equal", () => {
  it("splits 500 € among 3 as 166,67 / 166,67 / 166,66", () => {
    const result = computeSplits({ method: "equal", amountCents: 50000, participantIds: ["hernan", "wife", "p3"] });
    expect(shares(result)).toEqual([
      ["hernan", 16667],
      ["wife", 16667],
      ["p3", 16666],
    ]);
  });

  it("gives the remainder cents one each to the first participants in order", () => {
    const result = computeSplits({ method: "equal", amountCents: 1003, participantIds: ["z", "y", "x", "w"] });
    expect(shares(result)).toEqual([
      ["z", 251],
      ["y", 251],
      ["x", 251],
      ["w", 250],
    ]);
  });

  it("always sums to the amount", () => {
    for (const amountCents of [1, 2, 99, 100, 101, 50000, 123457]) {
      for (let n = 1; n <= 7; n++) {
        const participantIds = Array.from({ length: n }, (_, i) => `u${i}`);
        expect(total(computeSplits({ method: "equal", amountCents, participantIds }))).toBe(amountCents);
      }
    }
  });
});

describe("computeSplits — exact", () => {
  it("keeps the given shares and drops participants with 0", () => {
    const result = computeSplits({ method: "exact", amountCents: 3000, participantIds: ["a", "b", "c"], exactCents: { a: 1000, b: 2000, c: 0 } });
    expect(shares(result)).toEqual([
      ["a", 1000],
      ["b", 2000],
    ]);
  });

  it("treats missing shares as 0", () => {
    const result = computeSplits({ method: "exact", amountCents: 3000, participantIds: ["a", "b"], exactCents: { a: 3000 } });
    expect(shares(result)).toEqual([["a", 3000]]);
  });

  it("rejects shares that do not sum to the amount", () => {
    expect(computeSplits({ method: "exact", amountCents: 3000, participantIds: ["a", "b"], exactCents: { a: 1000, b: 1000 } })).toEqual({
      ok: false,
      error: "sum_mismatch",
    });
  });

  it("rejects negative and non-integer shares", () => {
    expect(computeSplits({ method: "exact", amountCents: 1000, participantIds: ["a", "b"], exactCents: { a: 1100, b: -100 } })).toEqual({
      ok: false,
      error: "invalid_amount",
    });
    expect(computeSplits({ method: "exact", amountCents: 1000, participantIds: ["a", "b"], exactCents: { a: 500.5, b: 499.5 } })).toEqual({
      ok: false,
      error: "invalid_amount",
    });
  });

  it("ignores shares of people who are not participants (excluded)", () => {
    expect(computeSplits({ method: "exact", amountCents: 1000, participantIds: ["a"], exactCents: { a: 1000, b: 500 } })).toEqual({
      ok: true,
      splits: [{ userId: "a", shareCents: 1000 }],
    });
  });
});

describe("computeSplits — percent", () => {
  it("rounds 100 € at 33.33 / 33.33 / 33.34 % and keeps the percentages", () => {
    const result = computeSplits({ method: "percent", amountCents: 10000, participantIds: ["a", "b", "c"], percentBp: { a: 3333, b: 3333, c: 3334 } });
    expect(result).toEqual({
      ok: true,
      splits: [
        { userId: "a", shareCents: 3333, percentBp: 3333 },
        { userId: "b", shareCents: 3333, percentBp: 3333 },
        { userId: "c", shareCents: 3334, percentBp: 3334 },
      ],
    });
  });

  it("gives leftover cents by largest fractional remainder, ties by participant order", () => {
    // 100 cents at 33.33% each + 0.01%: raw 33.33, 33.33, 33.34 -> floors 33, 33, 33; remainders .33, .33, .34
    const result = computeSplits({ method: "percent", amountCents: 100, participantIds: ["a", "b", "c"], percentBp: { a: 3333, b: 3333, c: 3334 } });
    expect(shares(result)).toEqual([
      ["a", 33],
      ["b", 33],
      ["c", 34],
    ]);
    // Equal remainders: 1 cent at 50/50 goes to the first participant.
    expect(shares(computeSplits({ method: "percent", amountCents: 1, participantIds: ["b", "a"], percentBp: { a: 5000, b: 5000 } }))).toEqual([
      ["b", 1],
      ["a", 0],
    ]);
  });

  it("requires the percentages to sum to 100 %", () => {
    expect(computeSplits({ method: "percent", amountCents: 1000, participantIds: ["a", "b"], percentBp: { a: 5000, b: 4000 } })).toEqual({
      ok: false,
      error: "percent_mismatch",
    });
  });

  it("does not lose precision on large amounts and always sums to the amount", () => {
    const amountCents = Number.MAX_SAFE_INTEGER - 1;
    const result = computeSplits({ method: "percent", amountCents, participantIds: ["a", "b", "c"], percentBp: { a: 3333, b: 3333, c: 3334 } });
    expect(total(result)).toBe(amountCents);
    for (const amount of [1, 7, 999, 123457]) {
      expect(total(computeSplits({ method: "percent", amountCents: amount, participantIds: ["a", "b", "c"], percentBp: { a: 1, b: 4999, c: 5000 } }))).toBe(amount);
    }
  });
});

describe("computeSplits — individual", () => {
  it("gives 100 % to the only participant", () => {
    expect(computeSplits({ method: "individual", amountCents: 4200, participantIds: ["a"] })).toEqual({ ok: true, splits: [{ userId: "a", shareCents: 4200 }] });
  });

  it("needs exactly one participant", () => {
    expect(computeSplits({ method: "individual", amountCents: 4200, participantIds: ["a", "b"] })).toEqual({ ok: false, error: "individual_needs_one" });
  });
});

describe("computePayers", () => {
  it("divides the amount equally among the payers, remainder cents first", () => {
    expect(computePayers({ amountCents: 30001, payerIds: ["hernan", "jack"], mode: "equal" })).toEqual({
      ok: true,
      payers: [
        { userId: "hernan", paidCents: 15001 },
        { userId: "jack", paidCents: 15000 },
      ],
    });
  });

  it("takes what each one paid when it adds up, dropping payers at 0", () => {
    expect(computePayers({ amountCents: 30000, payerIds: ["hernan", "jack", "marly"], mode: "exact", exactCents: { hernan: 20000, jack: 10000 } })).toEqual({
      ok: true,
      payers: [
        { userId: "hernan", paidCents: 20000 },
        { userId: "jack", paidCents: 10000 },
      ],
    });
    expect(computePayers({ amountCents: 30000, payerIds: ["hernan", "jack"], mode: "exact", exactCents: { hernan: 20000 } })).toEqual({ ok: false, error: "sum_mismatch" });
  });

  it("needs at least one payer and a positive amount", () => {
    expect(computePayers({ amountCents: 30000, payerIds: [], mode: "equal" })).toEqual({ ok: false, error: "no_participants" });
    expect(computePayers({ amountCents: 0, payerIds: ["hernan"], mode: "equal" })).toEqual({ ok: false, error: "invalid_amount" });
  });
});
