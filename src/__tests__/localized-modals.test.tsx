// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const syncPendingMutations = vi.fn(async () => {});
const itineraryState = { syncPendingMutations };

vi.mock("@/store/use-itinerary-store", () => ({
  useItineraryStore: (selector: (s: typeof itineraryState) => unknown) => selector(itineraryState),
}));

vi.mock("@/lib/offline-state", () => ({
  countPendingOfflineMutations: async () => 0,
}));

const authState = {
  user: { id: "u1", is_anonymous: false },
  session: { access_token: "token" },
};

vi.mock("@/store/use-auth-store", () => {
  const useAuthStore = () => authState;
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

import { OfflineStatus } from "@/components/OfflineStatus";
import { ActivityCommentsModal } from "@/components/ActivityCommentsModal";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

beforeEach(() => mockMatchMedia());
afterEach(() => {
  cleanup();
  setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OfflineStatus banner", () => {
  it.each([
    ["en", "You are offline"],
    ["es", "Sin conexión"],
  ] as const)("shows the offline banner in %s", async (lang, text) => {
    vi.useFakeTimers();
    setOnline(false);
    renderWithI18n(<OfflineStatus />, lang);

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText(text)).toBeTruthy();
  });
});

describe("ActivityCommentsModal empty state", () => {
  it.each([
    ["en", "No comments yet", "Write a comment..."],
    ["es", "Sin comentarios aún", "Escribe un comentario..."],
  ] as const)("renders empty state and placeholder in %s", async (lang, empty, placeholder) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ comments: [] }) })),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    renderWithI18n(
      <ActivityCommentsModal tripId="t1" activityId="a1" activityTitle="Temple" onClose={() => {}} />,
      lang,
    );

    expect(await screen.findByText(empty)).toBeTruthy();
    expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
  });
});
