import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/components/I18nProvider";
import type { Activity, ActivityState, TripDay, TripPlan } from "@/lib/types";

/** jsdom has no matchMedia; `matches` decides the answer per query. */
export function mockMatchMedia(matches: (query: string) => boolean = () => false) {
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

export function renderWithI18n(ui: ReactElement, lang: "es" | "en" = "es") {
  window.localStorage.setItem("app_lang", lang);
  return render(<I18nProvider>{ui}</I18nProvider>);
}

export function makeActivity(id: string, overrides: Partial<Activity> & { state?: ActivityState } = {}): Activity {
  return {
    id,
    title: `Activity ${id}`,
    time: "10:00",
    durationMin: 60,
    category: "sightseeing",
    priority: "medium",
    state: "pending",
    sort_order: 0,
    ...overrides,
  } as Activity;
}

export function makeDay(id: string, activities: Activity[]): TripDay {
  return { id, date: "2026-10-26", city: "Tokyo", label: id, activities, userId: "u" };
}

export function makeTrip(days: TripDay[]): TripPlan {
  return { id: "t", name: "Trip", days, criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [] };
}
