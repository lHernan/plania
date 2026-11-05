/**
 * Steps of the trip screen tour, in visual order. Each one points at an element marked with
 * `data-tour="<id>"`; steps whose element is not on screen (invitees, screen size, no day yet)
 * are skipped. The tour runs on the itinerary, so what lives in other sections is explained on
 * that section's link. Texts are i18n keys `tour_<id>_title` / `tour_<id>_body` (dashes → underscores).
 */
/** anchorless: shown centered, without a highlighted section (the brand welcome). */
export type TourStep = { id: string; anchorless?: boolean };

export const TOUR_STEPS: readonly TourStep[] = [
  { id: "welcome", anchorless: true },
  { id: "trip-switcher" },
  { id: "sections" },
  { id: "day-strip" },
  { id: "day-tools" },
  { id: "timeline" },
  { id: "section-wallet" },
  { id: "section-overview" },
  { id: "travel-agent" },
  { id: "share" },
  { id: "tour-help" },
];

export const tourKey = (step: TourStep, part: "title" | "body") => `tour_${step.id.replace(/-/g, "_")}_${part}`;
