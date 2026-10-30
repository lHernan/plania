import { differenceInMinutes, parse } from "date-fns";
import { checkoutClashes } from "@/lib/schedule/fit";
import { OptimizationSuggestion, TripDay } from "@/lib/types";

/** The app's t() from useI18n, so the notes come out in the language the traveler chose. */
type Translate = (key: string, variables?: Record<string, string | number>) => string;

const toDate = (time: string) => parse(time, "HH:mm", new Date());

export function optimizeDay(day: TripDay, t: Translate): OptimizationSuggestion[] {
  const sorted = [...day.activities].sort((a, b) => a.time.localeCompare(b.time));
  const suggestions: OptimizationSuggestion[] = [];

  const clashes = checkoutClashes(sorted, day.date);
  const clashing = new Set(clashes.map(({ checkout, departure }) => `${checkout.id}|${departure.id}`));
  for (const { checkout, departure, time } of clashes) {
    suggestions.push({
      id: `checkout-before-departure-${checkout.id}`,
      title: t("optimizer_checkout_after_departure_title", { checkout: checkout.title, departure: departure.title }),
      reason: t("optimizer_checkout_after_departure_reason", { time }),
      impact: "time",
      fix: { activityId: checkout.id, time },
    });
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    // Already explained (with its fix) by the check-out note above.
    if (clashing.has(`${current.id}|${next.id}`) || clashing.has(`${next.id}|${current.id}`)) continue;
    const currentEnd = new Date(toDate(current.time).getTime() + current.durationMin * 60000);
    const gap = differenceInMinutes(toDate(next.time), currentEnd);

    if (gap < 0) {
      suggestions.push({
        id: `overlap-${current.id}`,
        title: t("optimizer_overlap_title", { current: current.title, next: next.title }),
        reason: t("optimizer_overlap_reason"),
        impact: "time",
      });
    } else if (gap < 20) {
      suggestions.push({
        id: `tight-${current.id}`,
        title: t("optimizer_tight_title", { current: current.title, next: next.title }),
        reason: t("optimizer_tight_reason"),
        impact: "comfort",
      });
    }
  }

  const hasPhotos = sorted.some((a) => a.category === "photos");
  if (hasPhotos) {
    suggestions.push({
      id: "photo-golden-hour",
      title: t("optimizer_golden_hour_title"),
      reason: t("optimizer_golden_hour_reason"),
      impact: "comfort",
    });
  }

  const pendingReservations = sorted.filter((a) => a.category === "reservation" && a.state !== "completed");
  if (pendingReservations.length) {
    suggestions.push({
      id: "bookings-first",
      title: t("optimizer_bookings_first_title"),
      reason: t("optimizer_bookings_first_reason"),
      impact: "time",
    });
  }

  return suggestions;
}
