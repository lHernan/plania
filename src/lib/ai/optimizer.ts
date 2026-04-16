import { differenceInMinutes, parse } from "date-fns";
import { OptimizationSuggestion, TripDay } from "@/lib/types";

const toDate = (time: string) => parse(time, "HH:mm", new Date());

export function optimizeDay(day: TripDay): OptimizationSuggestion[] {
  const sorted = [...day.activities].sort((a, b) => a.time.localeCompare(b.time));
  const suggestions: OptimizationSuggestion[] = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const currentEnd = new Date(toDate(current.time).getTime() + current.durationMin * 60000);
    const gap = differenceInMinutes(toDate(next.time), currentEnd);

    if (gap < 0) {
      suggestions.push({
        id: `overlap-${current.id}`,
        title: `Schedule conflict: ${current.title} overlaps with ${next.title}`,
        reason: "Move one activity to avoid impossible timing.",
        impact: "time",
      });
    } else if (gap < 20) {
      suggestions.push({
        id: `tight-${current.id}`,
        title: `Tight transfer between ${current.title} and ${next.title}`,
        reason: "Add buffer for transport delays and walking.",
        impact: "comfort",
      });
    }
  }

  const hasPhotos = sorted.some((a) => a.category === "photos");
  if (hasPhotos) {
    suggestions.push({
      id: "photo-golden-hour",
      title: "Move photo spots near golden hour",
      reason: "Best light for views and city skyline shots.",
      impact: "comfort",
    });
  }

  const pendingReservations = sorted.filter((a) => a.category === "reservation" && a.state !== "completed");
  if (pendingReservations.length) {
    suggestions.push({
      id: "bookings-first",
      title: "Book pending reservation windows early",
      reason: "High-demand slots sell out quickly in peak season.",
      impact: "time",
    });
  }

  return suggestions;
}
