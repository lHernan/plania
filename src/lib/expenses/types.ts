/** Expense categories in display order. */
export const EXPENSE_CATEGORIES = ["flights", "lodging", "transport", "food", "activities", "shopping", "other"] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** How an expense is divided among its participants. */
export type SplitMethod = "equal" | "exact" | "percent" | "individual";

/** One participant's part of an expense, in minor units (cents). */
export type ExpenseSplit = {
  userId: string;
  shareCents: number;
  /** Basis points (10000 = 100 %), only for percent splits. */
  percentBp?: number;
};

export type Expense = {
  id: string;
  tripId: string;
  activityId: string | null;
  title: string;
  amountCents: number;
  currency: string;
  /** yyyy-MM-dd */
  spentOn: string;
  category: ExpenseCategory;
  paidBy: string;
  splitMethod: SplitMethod;
  notes: string | null;
  receiptPath: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  splits: ExpenseSplit[];
};

/** A recorded payment that settles (part of) a debt between two people. */
export type Settlement = {
  id: string;
  tripId: string;
  fromUser: string;
  toUser: string;
  amountCents: number;
  currency: string;
  /** yyyy-MM-dd */
  settledOn: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
};

/** A suggested payment: `from` pays `to`. */
export type Transfer = {
  from: string;
  to: string;
  amountCents: number;
  currency: string;
};
