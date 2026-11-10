// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/image-compress", () => ({ compressImage: async (file: File) => file }));

const {
  addSettlement,
  deleteExpense,
  deleteSettlement,
  loadExpenses,
  loadSettlements,
  mapExpenseFromDb,
  saveExpense,
} = await import("@/lib/expenses/sync");
const { receiptObjectPath, removeReceipt, uploadReceipt, TRIP_RECEIPTS_BUCKET } = await import("@/lib/expenses/receipts");

type DbError = { code?: string; message?: string } | null;
type Result = { data: unknown; error: DbError };

/** A chainable fake of the supabase client: every call goes to one ordered log. */
function fakeClient(options: { tables?: Record<string, Result>; rpc?: Record<string, Result>; upload?: DbError; remove?: DbError } = {}) {
  const log: unknown[][] = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "order", "insert", "delete"]) {
      q[op] = (...args: unknown[]) => (log.push([`${table}.${op}`, ...args]), q);
    }
    q.then = (resolve: (r: Result) => void) => resolve(options.tables?.[table] ?? { data: [], error: null });
    return q;
  };
  const rpc = async (fn: string, args: unknown) => (log.push(["rpc", fn, args]), options.rpc?.[fn] ?? { data: null, error: null });
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _file: File, opts: unknown) => (log.push(["upload", bucket, path, opts]), { error: options.upload ?? null }),
      remove: async (paths: string[]) => (log.push(["remove", bucket, paths]), { error: options.remove ?? null }),
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
    }),
  };
  return { client: { from, rpc, storage } as never, log };
}

const TRIP = "11111111-1111-4111-8111-111111111111";
const EXPENSE = "22222222-2222-4222-8222-222222222222";

const row = {
  id: EXPENSE,
  trip_id: TRIP,
  activity_id: null,
  title: "Apartamento",
  amount_cents: 50000,
  currency: "EUR",
  spent_on: "2026-11-02",
  category: "lodging",
  expense_payers: [{ user_id: "hernan", paid_cents: 50000 }],
  split_method: "equal",
  notes: null,
  receipt_path: null,
  created_by: "hernan",
  created_at: "2026-11-02T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  expense_splits: [
    { user_id: "hernan", share_cents: 16667, percent_bp: null },
    { user_id: "maria", share_cents: 16667, percent_bp: null },
    { user_id: "jack", share_cents: 16666, percent_bp: null },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("expense mapping", () => {
  it("maps a row with its embedded splits to the domain type", () => {
    expect(mapExpenseFromDb({ ...row, amount_cents: "50000" as never, expense_splits: [{ user_id: "maria", share_cents: 50000, percent_bp: 10000 }] })).toEqual({
      id: EXPENSE,
      tripId: TRIP,
      activityId: null,
      title: "Apartamento",
      amountCents: 50000,
      currency: "EUR",
      spentOn: "2026-11-02",
      category: "lodging",
      payers: [{ userId: "hernan", paidCents: 50000 }],
      splitMethod: "equal",
      notes: null,
      receiptPath: null,
      createdBy: "hernan",
      createdAt: "2026-11-02T10:00:00Z",
      updatedAt: "2026-11-02T10:00:00Z",
      splits: [{ userId: "maria", shareCents: 50000, percentBp: 10000 }],
    });
  });

  it("falls back to 'other' for an unknown category", () => {
    expect(mapExpenseFromDb({ ...row, category: "weird" }).category).toBe("other");
  });
});

describe("loadExpenses", () => {
  it("selects the trip's expenses with their splits", async () => {
    const fake = fakeClient({ tables: { expenses: { data: [row], error: null } } });
    const result = await loadExpenses(fake.client, TRIP);
    expect(result.error).toBeUndefined();
    expect(result.expenses).toHaveLength(1);
    expect(result.expenses[0].splits.map((s) => s.shareCents)).toEqual([16667, 16667, 16666]);
    expect(fake.log).toContainEqual(["expenses.select", "*, expense_payers(user_id, paid_cents), expense_splits(user_id, share_cents, percent_bp)"]);
    expect(fake.log).toContainEqual(["expenses.eq", "trip_id", TRIP]);
  });

  it.each([
    [{ code: "42P01", message: 'relation "expenses" does not exist' }, "unavailable"],
    [{ code: "PGRST205", message: "Could not find the table 'public.expenses' in the schema cache" }, "unavailable"],
    [{ code: "42501", message: "permission denied" }, "forbidden"],
    [{ code: "500", message: "boom" }, "failed"],
  ] as const)("maps %o to %s", async (error, expected) => {
    const fake = fakeClient({ tables: { expenses: { data: null, error } } });
    expect(await loadExpenses(fake.client, TRIP)).toEqual({ expenses: [], error: expected });
  });

  it("is offline without calling the server", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fake = fakeClient();
    expect(await loadExpenses(fake.client, TRIP)).toEqual({ expenses: [], error: "offline" });
    expect(fake.log).toEqual([]);
  });

  it("never throws", async () => {
    const throwing = { from: () => { throw new Error("network"); } } as never;
    expect(await loadExpenses(throwing, TRIP)).toEqual({ expenses: [], error: "failed" });
  });
});

describe("settlements", () => {
  const settlementRow = {
    id: "s1",
    trip_id: TRIP,
    from_user: "maria",
    to_user: "hernan",
    amount_cents: 8500,
    currency: "EUR",
    settled_on: "2026-11-03",
    note: null,
    created_by: "maria",
    created_at: "2026-11-03T10:00:00Z",
  };

  it("loads and maps the trip's settlements", async () => {
    const fake = fakeClient({ tables: { expense_settlements: { data: [settlementRow], error: null } } });
    expect(await loadSettlements(fake.client, TRIP)).toEqual({
      settlements: [
        { id: "s1", tripId: TRIP, fromUser: "maria", toUser: "hernan", amountCents: 8500, currency: "EUR", settledOn: "2026-11-03", note: null, createdBy: "maria", createdAt: "2026-11-03T10:00:00Z" },
      ],
    });
    expect(fake.log).toContainEqual(["expense_settlements.eq", "trip_id", TRIP]);
  });

  it("inserts a settlement with the debt's people, amount and currency", async () => {
    const fake = fakeClient();
    expect(await addSettlement(fake.client, { tripId: TRIP, fromUser: "maria", toUser: "hernan", amountCents: 8500, currency: "EUR", settledOn: "2026-11-03", note: "Bizum" })).toEqual({});
    expect(fake.log).toContainEqual([
      "expense_settlements.insert",
      [{ trip_id: TRIP, from_user: "maria", to_user: "hernan", amount_cents: 8500, currency: "EUR", settled_on: "2026-11-03", note: "Bizum" }],
    ]);
  });

  it("deletes a settlement by id and reports a row RLS did not let go as forbidden", async () => {
    const ok = fakeClient({ tables: { expense_settlements: { data: [{ id: "s1" }], error: null } } });
    expect(await deleteSettlement(ok.client, "s1")).toEqual({});
    expect(ok.log).toContainEqual(["expense_settlements.eq", "id", "s1"]);
    const denied = fakeClient({ tables: { expense_settlements: { data: [], error: null } } });
    expect(await deleteSettlement(denied.client, "s1")).toEqual({ error: "forbidden" });
  });
});

describe("saveExpense", () => {
  const input = {
    tripId: TRIP,
    activityId: null,
    title: "Cena",
    amountCents: 10000,
    currency: "EUR",
    spentOn: "2026-11-03",
    category: "food" as const,
    payers: [{ userId: "maria", paidCents: 6000 }, { userId: "hernan", paidCents: 4000 }],
    splitMethod: "percent" as const,
    notes: "",
    splits: [
      { userId: "maria", shareCents: 6000, percentBp: 6000 },
      { userId: "hernan", shareCents: 4000, percentBp: 4000 },
    ],
  };

  it("creates through save_expense with snake_case payloads and returns the new id", async () => {
    const fake = fakeClient({ rpc: { save_expense: { data: EXPENSE, error: null } } });
    expect(await saveExpense(fake.client, input)).toEqual({ id: EXPENSE });
    expect(fake.log).toEqual([
      [
        "rpc",
        "save_expense",
        {
          p_expense: { trip_id: TRIP, activity_id: null, title: "Cena", amount_cents: 10000, currency: "EUR", spent_on: "2026-11-03", category: "food", split_method: "percent", notes: null },
          p_payers: [
            { user_id: "maria", paid_cents: 6000 },
            { user_id: "hernan", paid_cents: 4000 },
          ],
          p_splits: [
            { user_id: "maria", share_cents: 6000, percent_bp: 6000 },
            { user_id: "hernan", share_cents: 4000, percent_bp: 4000 },
          ],
        },
      ],
    ]);
  });

  it("sends the id when editing", async () => {
    const fake = fakeClient({ rpc: { save_expense: { data: EXPENSE, error: null } } });
    await saveExpense(fake.client, { ...input, id: EXPENSE, splitMethod: "equal", splits: [{ userId: "maria", shareCents: 10000 }] });
    const [, , args] = fake.log[0] as [string, string, { p_expense: Record<string, unknown>; p_splits: unknown[] }];
    expect(args.p_expense.id).toBe(EXPENSE);
    expect(args.p_splits).toEqual([{ user_id: "maria", share_cents: 10000, percent_bp: null }]);
  });

  it.each([
    [{ code: "42501" }, "forbidden"],
    [{ code: "23514" }, "invalid"],
    [{ code: "PGRST202", message: "Could not find the function public.save_expense" }, "unavailable"],
    [{ code: "XX000" }, "failed"],
  ] as const)("maps %o to %s", async (error, expected) => {
    const fake = fakeClient({ rpc: { save_expense: { data: null, error } } });
    expect(await saveExpense(fake.client, input)).toEqual({ error: expected });
  });

  it("does nothing offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fake = fakeClient();
    expect(await saveExpense(fake.client, input)).toEqual({ error: "offline" });
    expect(fake.log).toEqual([]);
  });
});

describe("deleteExpense", () => {
  it("removes the receipt object before the row (storage policies need the row)", async () => {
    const fake = fakeClient({ tables: { expenses: { data: [{ id: EXPENSE }], error: null } } });
    const path = `${TRIP}/${EXPENSE}/33333333-3333-4333-8333-333333333333.jpg`;
    expect(await deleteExpense(fake.client, { id: EXPENSE, receiptPath: path })).toEqual({});
    expect(fake.log.map((entry) => entry[0])).toEqual(["remove", "expenses.delete", "expenses.eq", "expenses.select"]);
    expect(fake.log[0]).toEqual(["remove", TRIP_RECEIPTS_BUCKET, [path]]);
    expect(fake.log).toContainEqual(["expenses.eq", "id", EXPENSE]);
  });

  it("reports forbidden when no row was deleted", async () => {
    const fake = fakeClient({ tables: { expenses: { data: [], error: null } } });
    expect(await deleteExpense(fake.client, { id: EXPENSE, receiptPath: null })).toEqual({ error: "forbidden" });
  });
});

describe("receipts", () => {
  const photo = () => new File(["x"], "ticket.jpeg", { type: "image/jpeg" });

  it("builds '<trip>/<expense>/<uuid>.jpg' paths", () => {
    expect(receiptObjectPath(TRIP, EXPENSE, "image/jpeg", "33333333-3333-4333-8333-333333333333")).toBe(`${TRIP}/${EXPENSE}/33333333-3333-4333-8333-333333333333.jpg`);
    expect(receiptObjectPath(TRIP, EXPENSE, "image/webp", "a")).toBe(`${TRIP}/${EXPENSE}/a.webp`);
    expect(receiptObjectPath(TRIP, EXPENSE, "image/png")).toMatch(new RegExp(`^${TRIP}/${EXPENSE}/[0-9a-f-]{36}\\.png$`));
  });

  it("uploads, then attaches the path, then removes the previous object", async () => {
    const fake = fakeClient();
    const previous = `${TRIP}/${EXPENSE}/old.jpg`;
    const result = await uploadReceipt(fake.client, { tripId: TRIP, expenseId: EXPENSE, file: photo(), previousPath: previous });
    expect(result.error).toBeUndefined();
    expect(result.path).toMatch(new RegExp(`^${TRIP}/${EXPENSE}/[0-9a-f-]{36}\\.jpg$`));
    expect(fake.log.map((entry) => entry[0])).toEqual(["upload", "rpc", "remove"]);
    expect(fake.log[0][1]).toBe("trip-receipts");
    expect(fake.log[1]).toEqual(["rpc", "set_expense_receipt", { p_expense_id: EXPENSE, p_path: result.path }]);
    expect(fake.log[2]).toEqual(["remove", "trip-receipts", [previous]]);
  });

  it("removes the uploaded object when attaching it fails", async () => {
    const fake = fakeClient({ rpc: { set_expense_receipt: { data: null, error: { code: "42501" } } } });
    const result = await uploadReceipt(fake.client, { tripId: TRIP, expenseId: EXPENSE, file: photo() });
    expect(result).toEqual({ error: "forbidden" });
    const uploaded = fake.log[0][2] as string;
    expect(fake.log.map((entry) => entry[0])).toEqual(["upload", "rpc", "remove"]);
    expect(fake.log[2]).toEqual(["remove", "trip-receipts", [uploaded]]);
  });

  it("rejects files the bucket would not take, without uploading", async () => {
    const fake = fakeClient();
    expect(await uploadReceipt(fake.client, { tripId: TRIP, expenseId: EXPENSE, file: new File(["x"], "a.gif", { type: "image/gif" }) })).toEqual({ error: "invalid" });
    expect(fake.log).toEqual([]);
  });

  it("detaches the receipt, then removes its object", async () => {
    const fake = fakeClient();
    const path = `${TRIP}/${EXPENSE}/old.jpg`;
    expect(await removeReceipt(fake.client, { expenseId: EXPENSE, path })).toEqual({});
    expect(fake.log).toEqual([
      ["rpc", "set_expense_receipt", { p_expense_id: EXPENSE, p_path: null }],
      ["remove", "trip-receipts", [path]],
    ]);
  });
});
