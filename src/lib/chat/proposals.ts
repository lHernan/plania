import type { Activity, ChatAction, ChatActivityPatch, CriticalReservation, TripPlan } from "@/lib/types";
import { isTripUndated } from "@/lib/trip-undated";

/** What happened to Tachi's proposal in this session; history replies have none. */
export type ProposalStatus = "pending" | "applied" | "dismissed";

type Translate = (key: string, variables?: Record<string, string | number>) => string;
type ProposalTrip = Pick<TripPlan, "days" | "travelContext">;

/** The itinerary store actions a proposal goes through; they persist and queue offline. */
export type ProposalStore = {
  addActivity: (activity: Omit<Activity, "id" | "tripId" | "userId">) => Promise<void>;
  patchActivity: (dayId: string, activityId: string, patch: Partial<Activity>) => Promise<void>;
  updateActivityState: (dayId: string, activityId: string, state: Activity["state"]) => Promise<boolean>;
  reorderActivitiesToOrder: (dayId: string, orderedActivityIds: string[]) => Promise<void>;
  addReservation: (reservation: Omit<CriticalReservation, "id" | "userId">) => Promise<void>;
};

function formatDate(date: string, lang: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" }).format(value).replace(".", "");
  const dayMonth = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" }).format(value).replace(".", "");
  return `${weekday} ${dayMonth}`;
}

/** "mar 27 oct" on a dated trip, "Día 2" on an undated one, whose dates are placeholders. */
function dayName(trip: ProposalTrip, dayId: string, t: Translate, lang: string) {
  const index = trip.days.findIndex((day) => day.id === dayId);
  if (index < 0) return t("chat_proposal_unknown_day");
  if (isTripUndated(trip)) return t("trip_view_day_number", { number: index + 1 });
  return formatDate(trip.days[index].date, lang);
}

function activityTitle(trip: ProposalTrip, dayId: string, activityId: string, t: Translate) {
  const activity = trip.days.find((day) => day.id === dayId)?.activities.find((item) => item.id === activityId);
  return activity?.title ?? t("chat_proposal_unknown_activity");
}

function describePatch(patch: ChatActivityPatch, t: Translate) {
  const changes: string[] = [];
  if (patch.title !== undefined) changes.push(t("chat_proposal_field_title", { value: patch.title }));
  if (patch.time !== undefined) changes.push(t("chat_proposal_field_time", { value: patch.time }));
  if (patch.durationMin !== undefined) changes.push(t("chat_proposal_field_duration", { value: patch.durationMin }));
  if (patch.location !== undefined) changes.push(t("chat_proposal_field_location", { value: patch.location }));
  if (patch.expectedCost !== undefined) changes.push(t("chat_proposal_field_cost", { value: patch.expectedCost }));
  if (patch.state !== undefined) changes.push(t("chat_proposal_field_state", { value: t(`chat_proposal_state_${patch.state}`) }));
  if (patch.notes !== undefined) changes.push(t("chat_proposal_field_notes"));
  if (patch.category !== undefined) changes.push(t("chat_proposal_field_category"));
  if (patch.priority !== undefined) changes.push(t("chat_proposal_field_priority"));
  if (patch.mapsUrl !== undefined || patch.reservationUrl !== undefined) changes.push(t("chat_proposal_field_links"));
  return changes.join(", ");
}

/** One proposed change in plain language, e.g. "Agregar «Museo del Prado» · mar 27 oct · 10:00". */
export function describeChatAction(action: ChatAction, trip: ProposalTrip, t: Translate, lang: string): string {
  switch (action.type) {
    case "add_activity":
      return t("chat_proposal_add_activity", {
        title: action.payload.title,
        day: dayName(trip, action.payload.dayId, t, lang),
        time: action.payload.time,
      });
    case "patch_activity":
      return t("chat_proposal_patch_activity", {
        title: activityTitle(trip, action.payload.dayId, action.payload.activityId, t),
        day: dayName(trip, action.payload.dayId, t, lang),
        changes: describePatch(action.payload.patch, t),
      });
    case "update_activity_state":
      return t("chat_proposal_update_state", {
        title: activityTitle(trip, action.payload.dayId, action.payload.activityId, t),
        state: t(`chat_proposal_state_${action.payload.state}`),
      });
    case "reorder_activities":
      return t("chat_proposal_reorder", { day: dayName(trip, action.payload.dayId, t, lang) });
    case "add_reservation":
      // An undated trip's reservation dates are placeholders too, so they are left out.
      return isTripUndated(trip) || !action.payload.reservationDate
        ? t("chat_proposal_add_reservation", { title: action.payload.title })
        : t("chat_proposal_add_reservation_dated", { title: action.payload.title, date: formatDate(action.payload.reservationDate, lang) });
  }
}

function findDay(trip: ProposalTrip, dayId: string) {
  return trip.days.find((day) => day.id === dayId);
}

function hasActivity(trip: ProposalTrip, dayId: string, activityId: string) {
  return Boolean(findDay(trip, dayId)?.activities.some((activity) => activity.id === activityId));
}

/** Whether every id the change refers to still exists in the trip as it is now. */
function stillApplies(action: ChatAction, trip: ProposalTrip) {
  switch (action.type) {
    case "add_activity":
      return Boolean(findDay(trip, action.payload.dayId));
    case "patch_activity":
    case "update_activity_state":
      return hasActivity(trip, action.payload.dayId, action.payload.activityId);
    case "reorder_activities": {
      const current = findDay(trip, action.payload.dayId)?.activities.map((activity) => activity.id);
      const ordered = action.payload.orderedActivityIds;
      return Boolean(current) && current!.length === ordered.length && new Set(ordered).size === ordered.length && ordered.every((id) => current!.includes(id));
    }
    case "add_reservation":
      return true;
  }
}

async function runAction(action: ChatAction, trip: ProposalTrip, store: ProposalStore) {
  switch (action.type) {
    case "add_activity": {
      const activities = findDay(trip, action.payload.dayId)?.activities ?? [];
      const sortOrder = activities.reduce((max, activity) => Math.max(max, activity.sort_order + 1), 0);
      await store.addActivity({ ...action.payload, sort_order: sortOrder, files: [] });
      return true;
    }
    case "patch_activity":
      await store.patchActivity(action.payload.dayId, action.payload.activityId, action.payload.patch);
      return true;
    case "update_activity_state":
      return store.updateActivityState(action.payload.dayId, action.payload.activityId, action.payload.state);
    case "reorder_activities":
      await store.reorderActivitiesToOrder(action.payload.dayId, action.payload.orderedActivityIds);
      return true;
    case "add_reservation":
      await store.addReservation(action.payload);
      return true;
  }
}

/**
 * Applies the confirmed changes in order. Each one is checked against the trip as it is at that
 * moment (an earlier change or another editor may have moved things), and skipped if it no longer fits.
 */
export async function applyChatActions(
  actions: ChatAction[],
  getTrip: () => ProposalTrip | null | undefined,
  store: ProposalStore,
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  for (const action of actions) {
    const trip = getTrip();
    if (!trip || !stillApplies(action, trip)) continue;
    if (await runAction(action, trip, store)) applied += 1;
  }
  return { applied, skipped: actions.length - applied };
}
