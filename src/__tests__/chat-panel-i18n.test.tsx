// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ChatPanel } from "@/components/ChatPanel";
import { useChatStore } from "@/store/use-chat-store";

const SPANISH_PROMPTS = [
  "¿Qué sigue en mi itinerario?",
  "Resume mi día",
  "Encuentra huecos en mi agenda",
  "¿Qué detalles del viaje faltan?",
];

const ENGLISH_PROMPTS = [
  "What's next on my itinerary?",
  "Summarize my day",
  "Find schedule gaps",
  "What trip details are missing?",
];

let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockMatchMedia();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  sendMessage = vi.fn(async () => {});
  useChatStore.setState({
    isOpen: true,
    messages: [],
    loadedTripId: "trip-1",
    loadingHistory: false,
    sending: false,
    error: null,
    loadMessages: vi.fn(async () => {}),
    sendMessage,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ChatPanel quick prompts i18n", () => {
  it("renders the quick prompts in Spanish", async () => {
    renderWithI18n(<ChatPanel tripId="trip-1" />, "es");

    for (const prompt of SPANISH_PROMPTS) {
      expect(await screen.findByRole("button", { name: prompt })).toBeTruthy();
    }
    for (const prompt of ENGLISH_PROMPTS) {
      expect(screen.queryByRole("button", { name: prompt })).toBeNull();
    }
  });

  it("renders the quick prompts in English", async () => {
    renderWithI18n(<ChatPanel tripId="trip-1" />, "en");

    for (const prompt of ENGLISH_PROMPTS) {
      expect(await screen.findByRole("button", { name: prompt })).toBeTruthy();
    }
    for (const prompt of SPANISH_PROMPTS) {
      expect(screen.queryByRole("button", { name: prompt })).toBeNull();
    }
  });

  it("fills and sends the Spanish text when a Spanish chip is clicked", async () => {
    renderWithI18n(<ChatPanel tripId="trip-1" />, "es");

    fireEvent.click(await screen.findByRole("button", { name: "Resume mi día" }));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Resume mi día");

    fireEvent.submit(textarea.closest("form") as HTMLFormElement);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("trip-1", "Resume mi día", "es"));
  });
});
