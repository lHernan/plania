import type { Activity, TripDay } from "@/lib/types";
import { formatCents } from "./money";
import type { Expense, ExpenseCategory } from "./types";

/** The expenses linked to each activity (activity id -> expenses, in list order). */
export function expensesByActivity(expenses: Expense[]): Map<string, Expense[]> {
  const byActivity = new Map<string, Expense[]>();
  for (const expense of expenses) {
    if (!expense.activityId) continue;
    const list = byActivity.get(expense.activityId);
    if (list) list.push(expense);
    else byActivity.set(expense.activityId, [expense]);
  }
  return byActivity;
}

/** What the expenses cost, one total per currency ("120,00 € · 30,00 US$"); undefined for none. */
export function spentLabel(expenses: Expense[] | undefined, locale: string): string | undefined {
  if (!expenses?.length) return undefined;
  const totals = new Map<string, number>();
  for (const expense of expenses) totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amountCents);
  return [...totals].map(([currency, cents]) => formatCents(cents, currency, locale)).join(" · ");
}

const TRANSPORT_BOOKINGS = new Set(["car_rental", "train", "ferry", "bus", "transfer"]);

/** The expense category an activity obviously maps to (a flight booking is a flight); else activities. */
export function categoryForActivity(activity: Pick<Activity, "category" | "booking">): ExpenseCategory {
  const type = activity.booking?.type;
  if (type === "flight") return "flights";
  if (type === "lodging" || activity.category === "hotel") return "lodging";
  if (type && TRANSPORT_BOOKINGS.has(type)) return "transport";
  if (activity.category === "food") return "food";
  if (activity.category === "shopping") return "shopping";
  return "activities";
}

export type ActivityOptionGroup = { dayId: string; date: string; label: string; options: { id: string; label: string; activity: Activity }[] };

/** The trip's activities to pick from, by day and in time order ("08:00 · Vuelo"). */
export function activityOptionGroups(days: TripDay[]): ActivityOptionGroup[] {
  return days
    .filter((day) => day.activities.length > 0)
    .map((day) => ({
      dayId: day.id,
      date: day.date,
      label: day.label,
      options: [...day.activities]
        .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.sort_order - b.sort_order)
        .map((activity) => ({ id: activity.id, label: activity.time ? `${activity.time} · ${activity.title}` : activity.title, activity })),
    }));
}
