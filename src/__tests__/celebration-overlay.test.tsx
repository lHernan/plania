// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import type { CelebrationEvent } from "@/hooks/use-celebration";

const event = (tier: CelebrationEvent["tier"], nextDayId?: string): CelebrationEvent => ({
  id: 1,
  tier,
  nextDayId,
  activityTitle: "Temple",
});

function renderOverlay(e: CelebrationEvent | null, lang: "es" | "en" = "es") {
  const onDismiss = vi.fn();
  const onNextDay = vi.fn();
  renderWithI18n(<CelebrationOverlay event={e} onDismiss={onDismiss} onNextDay={onNextDay} />, lang);
  return { onDismiss, onNextDay };
}

const liveRegion = () => screen.getByRole("status");

beforeEach(() => mockMatchMedia());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CelebrationOverlay — single activity", () => {
  it("shows the Tachao toast with its secondary line", () => {
    renderOverlay(event(1));
    expect(screen.getAllByText("¡Tachao! ✨").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Una experiencia más para el recuerdo").length).toBeGreaterThan(0);
  });

  it("announces it to screen readers", () => {
    renderOverlay(event(1));
    expect(liveRegion().textContent).toBe("¡Tachao! ✨ Una experiencia más para el recuerdo");
  });

  it("celebrates a bought shopping item with its name", () => {
    renderOverlay({ id: 2, tier: 1, activityTitle: "Mojo picón", kind: "shopping" });
    expect(screen.getAllByText("«Mojo picón» ya es tuyo").length).toBeGreaterThan(0);
    expect(liveRegion().textContent).toBe("¡Tachao! ✨ «Mojo picón» ya es tuyo");
  });

  it("dismisses itself after 1.8 seconds", () => {
    vi.useFakeTimers();
    const { onDismiss } = renderOverlay(event(1));
    act(() => vi.advanceTimersByTime(1700));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders in the selected language", () => {
    renderOverlay(event(1), "en");
    expect(liveRegion().textContent).toBe("Tachao! ✨ One more experience for the memories");
  });
});

describe("CelebrationOverlay — day completed", () => {
  it("shows only the day celebration, not the activity toast", () => {
    renderOverlay(event(2, "d3"));
    expect(screen.getAllByText("¡Día tachao! 🎉").length).toBeGreaterThan(0);
    expect(screen.queryByText("¡Tachao! ✨")).toBeNull();
  });

  it("goes to the next pending day from its action", () => {
    const { onNextDay } = renderOverlay(event(2, "d3"));
    fireEvent.click(screen.getByRole("button", { name: "¡A por el siguiente día! →" }));
    expect(onNextDay).toHaveBeenCalledWith("d3");
  });

  it("hides the next-day action when no day is pending", () => {
    renderOverlay(event(2));
    expect(screen.queryByRole("button", { name: "¡A por el siguiente día! →" })).toBeNull();
  });

  it("does not block the page behind it", () => {
    renderOverlay(event(2, "d3"));
    expect(document.querySelector('[class*="bg-black"]')).toBeNull();
    const card = screen.getByRole("button", { name: "Cerrar" }).parentElement!;
    expect(card.parentElement!.className).toContain("pointer-events-none");
  });

  it("can be closed manually", () => {
    const { onDismiss } = renderOverlay(event(2, "d3"));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("CelebrationOverlay — trip completed", () => {
  it("shows the trip celebration without a next-day action", () => {
    renderOverlay(event(3));
    expect(liveRegion().textContent).toBe("¡Viaje tachao! ✈️ El destino se acaba, los recuerdos se quedan.");
    expect(screen.queryByRole("button", { name: "¡A por el siguiente día! →" })).toBeNull();
  });
});

describe("CelebrationOverlay — reduced motion", () => {
  it("skips the confetti but keeps the message", () => {
    mockMatchMedia((q) => q.includes("prefers-reduced-motion"));
    renderOverlay(event(3));
    expect(document.querySelector('[class*="z-[131]"]')).toBeNull();
    expect(screen.getAllByText("¡Viaje tachao! ✈️").length).toBeGreaterThan(0);
  });

  it("shows confetti when motion is allowed", () => {
    renderOverlay(event(3));
    expect(document.querySelector('[class*="z-[131]"]')).not.toBeNull();
  });
});

describe("CelebrationOverlay — nothing to celebrate", () => {
  it("renders nothing visible and announces nothing", () => {
    renderOverlay(null);
    expect(liveRegion().textContent).toBe("");
    expect(screen.queryByText("¡Tachao! ✨")).toBeNull();
  });
});
