// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const { FloatingActions } = await import("@/components/FloatingActions");

const ASK = "¡Pregúntale a Tachi!";

beforeEach(() => mockMatchMedia());
afterEach(cleanup);

describe("FloatingActions", () => {
  it("groups add and Tachi in one row with consistent spacing", () => {
    renderWithI18n(<FloatingActions onAdd={vi.fn()} onAskTachi={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Agregar actividad" });
    const tachi = screen.getByRole("button", { name: ASK });
    expect(add.parentElement).toBe(tachi.parentElement);
    expect(add.parentElement!.className).toContain("gap-");
  });

  it("does not position its buttons on their own", () => {
    renderWithI18n(<FloatingActions onAdd={vi.fn()} onAskTachi={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).not.toMatch(/\b(fixed|absolute)\b|\bbottom-|\bright-/);
    }
  });

  it("lets the caller place the group", () => {
    renderWithI18n(<FloatingActions onAskTachi={vi.fn()} className="fixed bottom-8 right-8" />);
    expect(screen.getByRole("button", { name: ASK }).parentElement!.className).toContain("fixed bottom-8 right-8");
  });

  it("runs each action", () => {
    const onAdd = vi.fn();
    const onAskTachi = vi.fn();
    renderWithI18n(<FloatingActions onAdd={onAdd} onAskTachi={onAskTachi} />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar actividad" }));
    fireEvent.click(screen.getByRole("button", { name: ASK }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAskTachi).toHaveBeenCalledTimes(1);
  });

  it("omits the add action for read-only viewers", () => {
    renderWithI18n(<FloatingActions onAskTachi={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Agregar actividad" })).toBeNull();
    expect(screen.getByRole("button", { name: ASK })).toBeTruthy();
  });

  it("has Tachi's button as a touch target of at least 44px", () => {
    renderWithI18n(<FloatingActions onAskTachi={vi.fn()} />);
    expect(screen.getByRole("button", { name: ASK }).className).toMatch(/\bsize-1[1-9]\b/);
  });
});
