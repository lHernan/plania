import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { DayDensity, Proposal } from "@/lib/bookings/plan";
import { proposalsToActivities } from "@/lib/bookings/import-session";
import { MAX_PLANNING_DAYS } from "@/lib/bookings/planning-prompt";
import type { TravelContext, TripDay, TripPlan } from "@/lib/types";

export type BudgetLevel = NonNullable<NonNullable<TravelContext["preferences"]>["budgetLevel"]>;

export const PLANNER_INTERESTS = ["culture", "food", "nature", "shopping", "nightlife"] as const;
export type PlannerInterest = (typeof PLANNER_INTERESTS)[number];

/** What the visitor fills in the planner: where, when (dates or a number of days) and the style. */
export type PlannerForm = {
  destinations: string;
  mode: "dates" | "days";
  startDate: string;
  endDate: string;
  dayCount: number;
  pace: DayDensity;
  budget: BudgetLevel;
  minimizeWalking: boolean;
  interests: PlannerInterest[];
};

/** A planned trip never goes beyond what the planning request accepts. */
export const MAX_PLANNER_DAYS = MAX_PLANNING_DAYS;
const DEFAULT_DAY_COUNT = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultPlannerForm(): PlannerForm {
  return {
    destinations: "",
    mode: "dates",
    startDate: "",
    endDate: "",
    dayCount: DEFAULT_DAY_COUNT,
    pace: "balanced",
    budget: "medium",
    minimizeWalking: false,
    interests: [],
  };
}

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DAY_COUNT;
  return Math.min(MAX_PLANNER_DAYS, Math.max(1, Math.round(value)));
}

/** The query the landing field passes to /plan: `dest` plus `start`/`end` or `days`. */
export function plannerQuery(input: { destinations: string; mode: PlannerForm["mode"]; startDate: string; endDate: string; dayCount: number }): string {
  const params = new URLSearchParams();
  if (input.destinations.trim()) params.set("dest", input.destinations.trim());
  if (input.mode === "days") {
    params.set("days", String(clampDays(input.dayCount)));
  } else {
    if (input.startDate) params.set("start", input.startDate);
    if (input.endDate) params.set("end", input.endDate);
  }
  return params.toString();
}

/** The planner form prefilled from the landing's query; anything malformed is ignored. */
export function formFromQuery(params: Pick<URLSearchParams, "get">): PlannerForm {
  const form = defaultPlannerForm();
  const dest = params.get("dest");
  if (dest) form.destinations = dest.slice(0, 200);
  const start = params.get("start");
  const end = params.get("end");
  if (start && DATE_RE.test(start)) form.startDate = start;
  if (end && DATE_RE.test(end)) form.endDate = end;
  const days = Number(params.get("days"));
  if (params.get("days") && Number.isFinite(days)) {
    form.mode = "days";
    form.dayCount = clampDays(days);
  }
  return form;
}

export function destinationList(destinations: string): string[] {
  return destinations.split(",").map((d) => d.trim()).filter(Boolean);
}

/**
 * The dates the trip covers. By number of days the data model still needs a date per day, so
 * the days start today and can be moved later.
 */
export function plannedDates(form: PlannerForm, today: Date = new Date()): string[] {
  if (form.mode === "dates" && DATE_RE.test(form.startDate)) {
    const start = parseISO(form.startDate);
    const end = DATE_RE.test(form.endDate) ? parseISO(form.endDate) : start;
    const span = differenceInCalendarDays(end, start);
    if (span < 0) return [];
    return Array.from({ length: Math.min(span + 1, MAX_PLANNER_DAYS) }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
  }
  if (form.mode === "days") {
    return Array.from({ length: clampDays(form.dayCount) }, (_, i) => format(addDays(today, i), "yyyy-MM-dd"));
  }
  return [];
}

/** Destinations shared across the days in order (two cities over four days: two days each). */
function cityForDay(cities: string[], index: number, total: number): string {
  if (cities.length === 0) return "";
  return cities[Math.min(cities.length - 1, Math.floor((index * cities.length) / total))];
}

/**
 * A trip that lives only on this device until it is saved, like a template: days built from the
 * dates and destinations, and the style kept in the travel context.
 */
export function buildDraftTrip(input: {
  id: string;
  name: string;
  destinations: string[];
  dates: string[];
  userId?: string | null;
  preferences?: TravelContext["preferences"];
}): TripPlan {
  const userId = input.userId ?? "";
  const days: TripDay[] = input.dates.map((date, index) => {
    const dayId = `${input.id}-day-${index + 1}`;
    const city = cityForDay(input.destinations, index, input.dates.length);
    return { id: dayId, date, city, label: `Day ${index + 1}`, userId, activities: [] };
  });
  return {
    id: input.id,
    name: input.name,
    userId: input.userId ?? null,
    ...(days.length > 0 ? { startDate: days[0].date, endDate: days[days.length - 1].date } : {}),
    ...(input.preferences ? { travelContext: { version: 1, preferences: input.preferences } } : {}),
    days,
    criticalReservations: [],
    shoppingItems: [],
    ignoredShoppingSuggestionKeys: [],
  };
}

/** Tachi's accepted proposals placed on their days, as suggested activities of the draft. */
export function withProposals(plan: TripPlan, proposals: Proposal[]): TripPlan {
  const activities = proposalsToActivities(proposals, plan.days);
  const userId = plan.userId ?? "";
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      activities: activities
        .filter((a) => a.dayId === day.id)
        .map((a, order) => ({ ...a, id: `${day.id}-act-${order + 1}`, tripId: plan.id, userId, sort_order: order })),
    })),
  };
}

export function newDraftId(): string {
  return `draft-${crypto.randomUUID()}`;
}

/** The style the planner keeps on the trip, in the travel context's own preferences. */
export function plannerPreferences(form: PlannerForm): NonNullable<TravelContext["preferences"]> {
  return { budgetLevel: form.budget, ...(form.minimizeWalking ? { minimizeWalking: true } : {}) };
}

/** Budget and interests travel to Tachi as the free-text wishes of the planning request. */
export function plannerWishes(form: PlannerForm): string {
  const parts = [`Budget: ${form.budget}.`];
  if (form.interests.length > 0) parts.push(`Interests: ${form.interests.join(", ")}.`);
  if (form.minimizeWalking) parts.push("Prefer little walking.");
  return parts.join(" ");
}

const STORAGE_KEY = "tachao_planner";

export type StoredPlanner = { form: PlannerForm; step: number; pendingGenerate: boolean };

/** The planner survives the sign-in (even a reload): kept for this tab only. */
export function savePlannerState(state: StoredPlanner): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, blocked): the form simply is not kept.
  }
}

export function loadPlannerState(): StoredPlanner | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPlanner>;
    if (!parsed || typeof parsed !== "object" || !parsed.form || typeof parsed.form !== "object") return null;
    const form = { ...defaultPlannerForm(), ...parsed.form };
    form.interests = Array.isArray(form.interests) ? form.interests.filter((i) => PLANNER_INTERESTS.includes(i)) : [];
    form.dayCount = clampDays(Number(form.dayCount));
    const step = typeof parsed.step === "number" ? Math.min(2, Math.max(0, Math.round(parsed.step))) : 0;
    return { form, step, pendingGenerate: parsed.pendingGenerate === true };
  } catch {
    return null;
  }
}

export function clearPlannerState(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
}
