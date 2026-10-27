/**
 * Steps of the trip screen tour, in visual order. Each one points at an element marked with
 * `data-tour="<id>"`; steps whose element is not on screen (invitees, screen size, no day yet)
 * are skipped. Texts are i18n keys `tour_<id>_title` / `tour_<id>_body` (dashes → underscores).
 */
export type TourStep = { id: string };

export const TOUR_STEPS: readonly TourStep[] = [
  { id: "trip-switcher" },
  { id: "day-strip" },
  { id: "day-tools" },
  { id: "timeline" },
  { id: "ai-shortcuts" },
  { id: "reservations" },
  { id: "shopping" },
  { id: "travel-tools" },
  { id: "travel-agent" },
  { id: "share" },
  { id: "tour-help" },
];

export const tourKey = (step: TourStep, part: "title" | "body") => `tour_${step.id.replace(/-/g, "_")}_${part}`;
