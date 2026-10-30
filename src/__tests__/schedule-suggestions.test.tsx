// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";
import { ScheduleSuggestions } from "@/components/ScheduleSuggestions";
import type { OptimizationSuggestion } from "@/lib/types";

const suggestion = (id: string, title: string): OptimizationSuggestion => ({ id, title, reason: "Add buffer for transport delays and walking.", impact: "comfort" });

describe("ScheduleSuggestions", () => {
  afterEach(cleanup);

  it("shows only a collapsed count until it is opened", () => {
    renderWithI18n(<ScheduleSuggestions suggestions={[suggestion("a", "Tight transfer A"), suggestion("b", "Tight transfer B")]} />, "en");
    const toggle = screen.getByRole("button", { name: /2 schedule notes/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Tight transfer A")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Tight transfer A")).toBeTruthy();
    expect(screen.getByText("Tight transfer B")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByText("Tight transfer A")).toBeNull();
  });

  it("uses the singular for one note", () => {
    renderWithI18n(<ScheduleSuggestions suggestions={[suggestion("a", "Tight transfer A")]} />, "en");
    expect(screen.getByRole("button", { name: /1 schedule note$/i })).toBeTruthy();
  });

  it("renders nothing when there are no notes", () => {
    const { container } = renderWithI18n(<ScheduleSuggestions suggestions={[]} />, "en");
    expect(container.textContent).toBe("");
  });
});

describe("ScheduleSuggestions fixes", () => {
  afterEach(cleanup);
  const withFix: OptimizationSuggestion = { ...suggestion("c", "Check-out after the flight"), fix: { activityId: "checkout", time: "07:45" } };

  it("applies a note's fix from its button", () => {
    const onApplyFix = vi.fn();
    renderWithI18n(<ScheduleSuggestions suggestions={[withFix]} onApplyFix={onApplyFix} />, "en");
    fireEvent.click(screen.getByRole("button", { name: /1 schedule note/i }));
    fireEvent.click(screen.getByRole("button", { name: "Move to 07:45" }));
    expect(onApplyFix).toHaveBeenCalledWith({ activityId: "checkout", time: "07:45" });
  });

  it("hides the fix button when the viewer cannot edit", () => {
    renderWithI18n(<ScheduleSuggestions suggestions={[withFix]} />, "en");
    fireEvent.click(screen.getByRole("button", { name: /1 schedule note/i }));
    expect(screen.queryByRole("button", { name: "Move to 07:45" })).toBeNull();
  });
});
