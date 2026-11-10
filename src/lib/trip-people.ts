import type { TripMember } from "@/lib/types";

/** A short name for a member: the first word of their profile name, else the email before "@". */
export function memberShortName(member: Pick<TripMember, "displayName" | "email"> | undefined): string {
  const name = member?.displayName?.trim();
  if (name) return name.split(/\s+/)[0];
  const local = member?.email?.split("@")[0]?.trim();
  return local || "?";
}

/** One or two letters for an avatar without a picture. */
export function memberInitials(member: Pick<TripMember, "displayName" | "email"> | undefined): string {
  const name = member?.displayName?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  }
  return (member?.email?.[0] ?? "?").toUpperCase();
}

/** "everyone" (the whole trip) or the id of the person whose itinerary is shown. */
export type ItineraryPerson = "everyone" | string;

const filterKey = (tripId: string) => `tachao:itinerary-person:${tripId}`;

/** The last itinerary filter chosen on this device for the trip; "everyone" by default. */
export function loadItineraryPerson(tripId: string): ItineraryPerson {
  try {
    return window.localStorage.getItem(filterKey(tripId)) || "everyone";
  } catch {
    return "everyone";
  }
}

export function saveItineraryPerson(tripId: string, person: ItineraryPerson): void {
  try {
    if (person === "everyone") window.localStorage.removeItem(filterKey(tripId));
    else window.localStorage.setItem(filterKey(tripId), person);
  } catch {
    // Private mode or blocked storage: the filter still works for this visit.
  }
}
