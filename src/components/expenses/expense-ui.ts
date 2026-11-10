import { BedDouble, Bus, CircleEllipsis, Plane, ShoppingBag, Ticket, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { ExpenseError } from "@/lib/expenses/sync";
import type { ExpenseCategory, SplitMethod } from "@/lib/expenses/types";
import type { SplitError } from "@/lib/expenses/splits";
import { memberShortName } from "@/lib/trip-people";
import { tripPath } from "@/lib/trip-routes";
import type { TripMember } from "@/lib/types";

export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  flights: Plane,
  lodging: BedDouble,
  transport: Bus,
  food: UtensilsCrossed,
  activities: Ticket,
  shopping: ShoppingBag,
  other: CircleEllipsis,
};

export const CATEGORY_KEYS: Record<ExpenseCategory, string> = {
  flights: "expenses_category_flights",
  lodging: "expenses_category_lodging",
  transport: "expenses_category_transport",
  food: "expenses_category_food",
  activities: "expenses_category_activities",
  shopping: "expenses_category_shopping",
  other: "expenses_category_other",
};

export const METHOD_KEYS: Record<SplitMethod, string> = {
  equal: "expenses_method_equal",
  exact: "expenses_method_exact",
  percent: "expenses_method_percent",
  individual: "expenses_method_individual",
};

export const ERROR_KEYS: Record<ExpenseError, string> = {
  offline: "expenses_error_offline",
  unavailable: "expenses_error_unavailable",
  forbidden: "expenses_error_forbidden",
  invalid: "expenses_error_invalid",
  failed: "expenses_error_failed",
};

export const SPLIT_ERROR_KEYS: Record<SplitError, string> = {
  no_participants: "expenses_error_no_participants",
  invalid_amount: "expenses_error_invalid_amount",
  sum_mismatch: "expenses_error_sum",
  percent_mismatch: "expenses_error_percent",
  individual_needs_one: "expenses_error_individual",
};

/** Today on this device as yyyy-MM-dd. */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A yyyy-MM-dd date in the user's language ("lun, 2 nov"). */
export function formatDay(iso: string, lang: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(new Date(year, month - 1, day));
}

/** Short names by user id; people no longer in the trip get the former-member label. */
export function personNamer(members: TripMember[], formerLabel: string) {
  const byId = new Map(members.map((member) => [member.userId, member]));
  return {
    member: (userId: string) => byId.get(userId),
    isMember: (userId: string) => byId.has(userId),
    name: (userId: string) => {
      const member = byId.get(userId);
      return member ? memberShortName(member) : formerLabel;
    },
  };
}

export type PersonNamer = ReturnType<typeof personNamer>;

export const cardClass = "rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4";
export const sectionTitleClass = "text-xs font-black uppercase tracking-wider text-[var(--color-text-muted)]";
/** Positive balances (they are owed) in green, negative (they owe) in the warning tone. */
export const balanceTone = (cents: number) =>
  cents > 0 ? "text-[var(--color-success)]" : cents < 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-secondary)]";

/** Search params of the Expenses section: `new` opens a new expense for that activity, `expense` opens one. */
export const EXPENSE_NEW_PARAM = "new";
export const EXPENSE_OPEN_PARAM = "expense";

/** The Expenses section opening a new expense for an activity, or an existing expense. */
export function expensesIntentHref(tripId: string, intent: { newForActivity: string } | { expenseId: string }): string {
  const [key, value] = "newForActivity" in intent ? [EXPENSE_NEW_PARAM, intent.newForActivity] : [EXPENSE_OPEN_PARAM, intent.expenseId];
  return `${tripPath(tripId, "expenses")}?${key}=${encodeURIComponent(value)}`;
}

type Translate = (key: string, variables?: Record<string, string | number>) => string;

/** "Pagó Ana", "Pagaron Ana y Jack", "Pagaron Ana y 2 más". */
export function payersLabel(payerIds: string[], people: PersonNamer, t: Translate): string {
  const [first, second] = payerIds.map((id) => people.name(id));
  if (payerIds.length <= 1) return t("expenses_paid_by", { name: first ?? people.name("") });
  if (payerIds.length === 2) return t("expenses_paid_by_two", { first, second });
  return t("expenses_paid_by_many", { first, count: payerIds.length - 1 });
}
