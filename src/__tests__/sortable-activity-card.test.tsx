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

describe("SortableActivityCard chips", () => {
  const file = (id: string, fileName: string) =>
    ({ id, activityId: "a", fileUrl: `https://x/${fileName}`, fileType: "pdf", fileName }) as NonNullable<Activity["files"]>[number];
  const flight = (files: Activity["files"] = []) =>
    makeActivity("a", {
      title: "Vuelo",
      origin: "booking",
      booking: { version: 1, type: "flight", role: "single", groupId: "g", title: "MAD → NRT", reference: "ABC123", fieldStatus: {} },
      files,
    });

  function renderChips(activity: Activity) {
    const handlers = { onComplete: vi.fn(), onUncomplete: vi.fn(), onEdit: vi.fn(), onOpenFile: vi.fn(), onOpenBooking: vi.fn() };
    const parentPointerDown = vi.fn();
    renderWithI18n(
      <div onPointerDown={parentPointerDown}>
        <DndContext>
          <SortableContext items={[activity.id]}>
            <SortableActivityCard activity={activity} {...handlers} />
          </SortableContext>
        </DndContext>
      </div>,
    );
    return { ...handlers, parentPointerDown };
  }

  it("shows a booking chip with the booking type and reference", () => {
    renderChips(flight());
    const chip = screen.getByRole("button", { name: "Ver la reserva de «Vuelo» en la Cartera" });
    expect(chip.textContent).toContain("ABC123");
  });

  it("the booking chip goes to the wallet without opening the activity", () => {
    const h = renderChips(flight());
    fireEvent.click(screen.getByRole("button", { name: "Ver la reserva de «Vuelo» en la Cartera" }));
    expect(h.onOpenBooking).toHaveBeenCalledTimes(1);
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it("with one document, the documents chip opens it in one tap", () => {
    const pass = file("f1", "boarding.pdf");
    const h = renderChips(flight([pass]));
    const chip = screen.getByRole("button", { name: "Abrir el pase de «Vuelo»" });
    expect(chip.textContent).toContain("1");
    fireEvent.click(chip);
    expect(h.onOpenFile).toHaveBeenCalledWith(pass);
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it("with several documents, the documents chip shows the count and still opens the pass in one tap", () => {
    const image = { ...file("f1", "photo.jpg"), fileType: "image" as const };
    const h = renderChips(flight([image, file("f2", "b.pdf"), file("f3", "c.pdf")]));
    const chip = screen.getByRole("button", { name: "Abrir el pase de «Vuelo» (3 documentos)" });
    expect(chip.textContent).toContain("3");
    fireEvent.click(chip);
    // As before the chips: the first PDF opens directly; the card itself still opens the detail.
    expect(h.onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ id: "f2" }));
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it("pressing a chip never reaches the card's drag and swipe handlers", () => {
    const h = renderChips(flight([file("f1", "a.pdf")]));
    fireEvent.pointerDown(screen.getByRole("button", { name: /reserva de «Vuelo»/ }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Abrir el pase de «Vuelo»" }));
    expect(h.parentPointerDown).not.toHaveBeenCalled();
  });

  it("shows no chips for a manual activity without documents", () => {
    renderChips(makeActivity("a", { title: "Paseo" }));
    expect(screen.queryByRole("button", { name: /reserva|pase|documentos/ })).toBeNull();
  });

  it("without a wallet action the booking is still marked, as a badge", () => {
    renderCard(flight());
    expect(screen.queryByRole("button", { name: /reserva de «Vuelo»/ })).toBeNull();
    expect(screen.getByText("Reserva")).toBeTruthy();
  });
});
