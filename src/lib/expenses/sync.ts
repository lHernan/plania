import { TRIP_RECEIPTS_BUCKET } from "./receipts";
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type ExpenseSplit, type Settlement, type SplitMethod } from "./types";

/**
 * Supabase persistence of trip expenses (src/lib/trip_expenses_migration.sql). Expenses and
 * splits are written only through the save_expense RPC; settlements are plain rows. Money is
 * online-only: nothing is queued offline, every call answers "offline" instead.
 */

export const EXPENSES_TABLE = "expenses";
export const SETTLEMENTS_TABLE = "expense_settlements";
export const EXPENSES_SELECT = "*, expense_splits(user_id, share_cents, percent_bp)";

/** Why an expense action did not happen. */
export type ExpenseError = "offline" | "unavailable" | "forbidden" | "invalid" | "failed";

type DbError = { code?: string; message?: string } | null;
type Thenable<T> = PromiseLike<{ data: T | null; error: DbError }>;
type Query<T> = Thenable<T> & {
  eq: (column: string, value: string) => Query<T>;
  select: (columns: string) => Query<T>;
};

/** The part of the supabase client this module and receipts.ts use. */
export type ExpensesClient = {
  from: (table: string) => {
    select: (columns: string) => Query<unknown[]>;
    insert: (rows: unknown[]) => Thenable<unknown>;
    delete: () => Query<unknown[]>;
  };
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError }>;
  storage: {
    from: (bucket: string) => {
      upload: (path: string, file: File, options: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
      remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
      createSignedUrl: (path: string, expiresIn: number) => PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

export type ExpenseSplitDb = { user_id: string; share_cents: number | string; percent_bp: number | null };

export type ExpenseDb = {
  id: string;
  trip_id: string;
  activity_id: string | null;
  title: string;
  amount_cents: number | string;
  currency: string;
  spent_on: string;
  category: string;
  paid_by: string;
  split_method: string;
  notes: string | null;
  receipt_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  expense_splits?: ExpenseSplitDb[] | null;
};

export type SettlementDb = {
  id: string;
  trip_id: string;
  from_user: string;
  to_user: string;
  amount_cents: number | string;
  currency: string;
  settled_on: string;
  note: string | null;
  created_by: string;
  created_at: string;
};

/** What saving an expense sends; no id creates one. */
export type ExpenseInput = {
  id?: string;
  tripId: string;
  activityId: string | null;
  title: string;
  amountCents: number;
  currency: string;
  spentOn: string;
  category: ExpenseCategory;
  paidBy: string;
  splitMethod: SplitMethod;
  notes: string | null;
  splits: ExpenseSplit[];
};

export type SettlementInput = {
  tripId: string;
  fromUser: string;
  toUser: string;
  amountCents: number;
  currency: string;
  /** yyyy-MM-dd; the database uses today when omitted. */
  settledOn?: string;
  note?: string | null;
};

const SPLIT_METHODS: SplitMethod[] = ["equal", "exact", "percent", "individual"];

export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** The migration was not applied yet: the tables or the RPCs do not exist. */
export function isMissingExpensesSchema(error: DbError): boolean {
  if (!error) return false;
  if (["42P01", "PGRST205", "PGRST202", "42883"].includes(String(error.code ?? ""))) return true;
  const message = error.message ?? "";
  return /expense|receipt/.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

export function mapExpenseError(error: DbError): ExpenseError {
  if (isMissingExpensesSchema(error)) return "unavailable";
  const code = String(error?.code ?? "");
  if (code === "42501") return "forbidden";
  if (code === "23514" || code === "22P02" || code === "P0002") return "invalid";
  return "failed";
}

export function mapExpenseFromDb(row: ExpenseDb): Expense {
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as ExpenseCategory) : "other";
  const splitMethod = SPLIT_METHODS.includes(row.split_method as SplitMethod) ? (row.split_method as SplitMethod) : "equal";
  return {
    id: row.id,
    tripId: row.trip_id,
    activityId: row.activity_id ?? null,
    title: row.title,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    spentOn: row.spent_on,
    category,
    paidBy: row.paid_by,
    splitMethod,
    notes: row.notes ?? null,
    receiptPath: row.receipt_path ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    splits: (row.expense_splits ?? []).map((split) => ({
      userId: split.user_id,
      shareCents: Number(split.share_cents),
      ...(split.percent_bp !== null && split.percent_bp !== undefined ? { percentBp: split.percent_bp } : {}),
    })),
  };
}

export function mapSettlementFromDb(row: SettlementDb): Settlement {
  return {
    id: row.id,
    tripId: row.trip_id,
    fromUser: row.from_user,
    toUser: row.to_user,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    settledOn: row.settled_on,
    note: row.note ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ─── Loading ─────────────────────────────────────────────────────────────────

/** The trip's expenses with their splits. It never throws. */
export async function loadExpenses(client: ExpensesClient, tripId: string): Promise<{ expenses: Expense[]; error?: ExpenseError }> {
  if (isOffline()) return { expenses: [], error: "offline" };
  try {
    const { data, error } = await client.from(EXPENSES_TABLE).select(EXPENSES_SELECT).eq("trip_id", tripId);
    if (error) return { expenses: [], error: mapExpenseError(error) };
    return { expenses: ((data ?? []) as ExpenseDb[]).map(mapExpenseFromDb) };
  } catch {
    return { expenses: [], error: "failed" };
  }
}

/** The trip's settlement history. It never throws. */
export async function loadSettlements(client: ExpensesClient, tripId: string): Promise<{ settlements: Settlement[]; error?: ExpenseError }> {
  if (isOffline()) return { settlements: [], error: "offline" };
  try {
    const { data, error } = await client.from(SETTLEMENTS_TABLE).select("*").eq("trip_id", tripId);
    if (error) return { settlements: [], error: mapExpenseError(error) };
    return { settlements: ((data ?? []) as SettlementDb[]).map(mapSettlementFromDb) };
  } catch {
    return { settlements: [], error: "failed" };
  }
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Creates or edits an expense and replaces its splits in one atomic call. */
export async function saveExpense(client: ExpensesClient, input: ExpenseInput): Promise<{ id?: string; error?: ExpenseError }> {
  if (isOffline()) return { error: "offline" };
  const p_expense = {
    ...(input.id ? { id: input.id } : {}),
    trip_id: input.tripId,
    activity_id: input.activityId,
    title: input.title.trim(),
    amount_cents: input.amountCents,
    currency: input.currency,
    spent_on: input.spentOn,
    category: input.category,
    paid_by: input.paidBy,
    split_method: input.splitMethod,
    notes: input.notes?.trim() || null,
  };
  const p_splits = input.splits.map((split) => ({ user_id: split.userId, share_cents: split.shareCents, percent_bp: split.percentBp ?? null }));
  try {
    const { data, error } = await client.rpc("save_expense", { p_expense, p_splits });
    if (error) return { error: mapExpenseError(error) };
    return typeof data === "string" && data ? { id: data } : { error: "failed" };
  } catch {
    return { error: "failed" };
  }
}

/** Deletes with `.select` so a row RLS kept (not the creator or owner) reads as forbidden. */
async function deleteRow(client: ExpensesClient, table: string, id: string): Promise<{ error?: ExpenseError }> {
  try {
    const { data, error } = await client.from(table).delete().eq("id", id).select("id");
    if (error) return { error: mapExpenseError(error) };
    return Array.isArray(data) && data.length === 0 ? { error: "forbidden" } : {};
  } catch {
    return { error: "failed" };
  }
}

/**
 * Deletes an expense (its splits cascade). The receipt object goes first, best effort: the
 * storage policies only let it go while the expense row still exists.
 */
export async function deleteExpense(client: ExpensesClient, expense: Pick<Expense, "id" | "receiptPath">): Promise<{ error?: ExpenseError }> {
  if (isOffline()) return { error: "offline" };
  if (expense.receiptPath) {
    try {
      await client.storage.from(TRIP_RECEIPTS_BUCKET).remove([expense.receiptPath]);
    } catch (error) {
      console.error("Tachao: receipt cleanup error", error);
    }
  }
  return deleteRow(client, EXPENSES_TABLE, expense.id);
}

/** Records that `fromUser` paid `toUser` (both must be current members of the trip). */
export async function addSettlement(client: ExpensesClient, input: SettlementInput): Promise<{ error?: ExpenseError }> {
  if (isOffline()) return { error: "offline" };
  const row = {
    trip_id: input.tripId,
    from_user: input.fromUser,
    to_user: input.toUser,
    amount_cents: input.amountCents,
    currency: input.currency,
    ...(input.settledOn ? { settled_on: input.settledOn } : {}),
    note: input.note?.trim() || null,
  };
  try {
    const { error } = await client.from(SETTLEMENTS_TABLE).insert([row]);
    return error ? { error: mapExpenseError(error) } : {};
  } catch {
    return { error: "failed" };
  }
}

export async function deleteSettlement(client: ExpensesClient, id: string): Promise<{ error?: ExpenseError }> {
  if (isOffline()) return { error: "offline" };
  return deleteRow(client, SETTLEMENTS_TABLE, id);
}
