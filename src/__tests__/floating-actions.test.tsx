// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const chat = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/store/use-chat-store", () => ({
  useChatStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: chat.open }),
}));

const { FloatingActions } = await import("@/components/FloatingActions");

beforeEach(() => mockMatchMedia());
afterEach(() => {
  cleanup();
  chat.open.mockReset();
});

describe("FloatingActions", () => {
  it("groups add and travel agent in one row with consistent spacing", () => {
    renderWithI18n(<FloatingActions onAdd={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Agregar actividad" });
    const agent = screen.getByRole("button", { name: /agente/i });
    expect(add.parentElement).toBe(agent.parentElement);
    expect(add.parentElement!.className).toContain("gap-");
  });

  it("does not position its buttons on their own", () => {
    renderWithI18n(<FloatingActions onAdd={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).not.toMatch(/\b(fixed|absolute)\b|\bbottom-|\bright-/);
    }
  });

  it("lets the caller place the group", () => {
    renderWithI18n(<FloatingActions className="fixed bottom-8 right-8" />);
    expect(screen.getByRole("button", { name: /agente/i }).parentElement!.className).toContain("fixed bottom-8 right-8");
  });

  it("runs each action", () => {
    const onAdd = vi.fn();
    renderWithI18n(<FloatingActions onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar actividad" }));
    fireEvent.click(screen.getByRole("button", { name: /agente/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(chat.open).toHaveBeenCalledTimes(1);
  });

  it("omits the add action for read-only viewers", () => {
    renderWithI18n(<FloatingActions />);
    expect(screen.queryByRole("button", { name: "Agregar actividad" })).toBeNull();
    expect(screen.getByRole("button", { name: /agente/i })).toBeTruthy();
  });
});
