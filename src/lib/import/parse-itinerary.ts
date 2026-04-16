import { format, parse } from "date-fns";
import { Activity, ActivityCategory } from "@/lib/types";

const categoryFromTitle = (title: string): ActivityCategory => {
  const lower = title.toLowerCase();
  if (lower.includes("train") || lower.includes("taxi") || lower.includes("flight")) {
    return "transport";
  }
  if (lower.includes("hotel") || lower.includes("check-in")) {
    return "hotel";
  }
  if (lower.includes("book") || lower.includes("reservation") || lower.includes("ticket")) {
    return "reservation";
  }
  if (lower.includes("food") || lower.includes("dinner") || lower.includes("lunch")) {
    return "food";
  }
  if (lower.includes("photo")) {
    return "photos";
  }
  return "sightseeing";
};

export function parseItineraryText(input: string, fallbackDayId: string): {
  dayDate: string | null;
  activities: Activity[];
} {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { dayDate: null, activities: [] };
  }

  const firstLine = lines[0];
  const dateMatch = firstLine.match(/^([A-Za-z]{3,9}\s+\d{1,2})/);
  const parsedDate = dateMatch
    ? parse(`${dateMatch[1]} ${new Date().getFullYear()}`, "MMMM d yyyy", new Date())
    : parse(`${dateMatch?.[1] ?? ""} ${new Date().getFullYear()}`, "MMM d yyyy", new Date());
  const dayDate = Number.isNaN(parsedDate.getTime()) ? null : format(parsedDate, "yyyy-MM-dd");

  const activities = lines
    .map<Activity | null>((line, index) => {
      const timeMatch = line.match(/(\d{1,2}:\d{2})\s+(.+)/);
      if (!timeMatch) {
        return null;
      }
      const [, time, title] = timeMatch;
      return {
        id: `imported-${Date.now()}-${index}`,
        dayId: fallbackDayId,
        city: "Unassigned",
        title,
        time,
        durationMin: 60,
        category: categoryFromTitle(title),
        priority: "medium",
        state: "pending",
        sort_order: index,
      };
    })
    .filter((item): item is Activity => Boolean(item));

  return { dayDate, activities };
}
