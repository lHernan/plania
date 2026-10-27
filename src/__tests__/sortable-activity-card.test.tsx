// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { makeActivity, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import { SortableActivityCard } from "@/components/SortableActivityCard";
import type { Activity } from "@/lib/types";

function renderCard(activity: Activity, lang: "es" | "en" = "es") {
  const handlers = { onComplete: vi.fn(), onUncomplete: vi.fn(), onEdit: vi.fn(), onComment: vi.fn() };
  renderWithI18n(
    <DndContext>
      <SortableContext items={[activity.id]}>
        <SortableActivityCard activity={activity} {...handlers} />
      </SortableContext>
    </DndContext>,
    lang
  );
  return handlers;
}

beforeEach(() => mockMatchMedia());
afterEach(cleanup);

describe("SortableActivityCard checkbox", () => {
  it("is an accessible unchecked checkbox for pending activities", () => {
    renderCard(makeActivity("a", { title: "Temple" }));
    const box = screen.getByRole("checkbox", { name: "Marcar «Temple» como hecha" });
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("completes a pending activity without opening its details", () => {
    const h = renderCard(makeActivity("a", { title: "Temple" }));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(h.onComplete).toHaveBeenCalledWith("a");
    expect(h.onUncomplete).not.toHaveBeenCalled();
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it("returns a completed activity to pending instead of celebrating again", () => {
    const h = renderCard(makeActivity("a", { title: "Temple", state: "completed" }));
    const box = screen.getByRole("checkbox", { name: "Marcar «Temple» como pendiente" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(h.onUncomplete).toHaveBeenCalledWith("a");
    expect(h.onComplete).not.toHaveBeenCalled();
  });

  it("labels the checkbox in the selected language", () => {
    renderCard(makeActivity("a", { title: "Temple" }), "en");
    expect(screen.getByRole("checkbox", { name: 'Mark "Temple" as done' })).toBeTruthy();
  });
});

describe("SortableActivityCard content", () => {
  it("keeps the completed title visible and readable", () => {
    renderCard(makeActivity("a", { title: "Temple", state: "completed" }));
    const title = screen.getByRole("heading", { name: "Temple" });
    expect(title.className).toContain("line-through");
    expect(title.className).not.toContain("opacity");
  });

  it("shows category, duration and location", () => {
    renderCard(makeActivity("a", { title: "Temple", durationMin: 90, location: "Senso-ji" }));
    expect(screen.getByText(/· 90/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Senso-ji/ })).toBeTruthy();
  });

  it("opens details when the card is clicked", () => {
    const h = renderCard(makeActivity("a", { title: "Temple" }));
    fireEvent.click(screen.getByRole("heading", { name: "Temple" }));
    expect(h.onEdit).toHaveBeenCalled();
  });
});

describe("SortableActivityCard attachments", () => {
  it("opens the attached pass straight from the card, without opening the activity", () => {
    const onOpenFile = vi.fn();
    const onEdit = vi.fn();
    const pass = { id: "f1", activityId: "a", fileUrl: "https://x/boarding.pdf", fileType: "pdf", fileName: "boarding.pdf" };
    renderWithI18n(
      <DndContext>
        <SortableContext items={["a"]}>
          <SortableActivityCard
            activity={makeActivity("a", { title: "Vuelo", files: [pass] as Activity["files"] })}
            onComplete={vi.fn()}
            onUncomplete={vi.fn()}
            onEdit={onEdit}
            onOpenFile={onOpenFile}
          />
        </SortableContext>
      </DndContext>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir el pase de «Vuelo»" }));
    expect(onOpenFile).toHaveBeenCalledWith(pass);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows no pass button without attachments", () => {
    renderCard(makeActivity("a", { title: "Vuelo" }));
    expect(screen.queryByRole("button", { name: /Abrir el pase/ })).toBeNull();
  });
});
