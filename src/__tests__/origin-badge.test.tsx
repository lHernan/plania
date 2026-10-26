// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { makeActivity, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import { OriginBadge } from "@/components/OriginBadge";
import { SortableActivityCard } from "@/components/SortableActivityCard";
import type { Activity, BookingDetails } from "@/lib/types";

const booking: BookingDetails = {
  version: 1,
  type: "flight",
  role: "departure",
  groupId: "g1",
  title: "MAD → SPC",
  reference: "XK7Q2P",
  fieldStatus: { reference: "extracted" },
};

beforeEach(() => mockMatchMedia());
afterEach(cleanup);

describe("OriginBadge", () => {
  it("marks confirmed bookings with their reference", () => {
    renderWithI18n(<OriginBadge activity={makeActivity("a", { origin: "booking", booking })} />);
    expect(screen.getByText("Reserva")).toBeTruthy();
    expect(screen.getByText("XK7Q2P")).toBeTruthy();
  });

  it("marks accepted AI suggestions", () => {
    renderWithI18n(<OriginBadge activity={makeActivity("a", { origin: "suggested" })} />);
    expect(screen.getByText("Sugerida")).toBeTruthy();
  });

  it("renders nothing for manual activities", () => {
    const { container } = renderWithI18n(<OriginBadge activity={makeActivity("a")} />);
    expect(container.textContent).toBe("");
  });

  it("is translated", () => {
    renderWithI18n(<OriginBadge activity={makeActivity("a", { origin: "booking", booking })} />, "en");
    expect(screen.getByText("Booking")).toBeTruthy();
  });
});

describe("SortableActivityCard origin", () => {
  const renderCard = (activity: Activity) =>
    renderWithI18n(
      <DndContext>
        <SortableContext items={[activity.id]}>
          <SortableActivityCard activity={activity} onComplete={() => {}} onUncomplete={() => {}} onEdit={() => {}} />
        </SortableContext>
      </DndContext>
    );

  it("shows the booking badge on the itinerary card", () => {
    renderCard(makeActivity("a", { title: "Vuelo", origin: "booking", booking }));
    expect(screen.getByText("Reserva")).toBeTruthy();
  });

  it("shows the suggestion badge on the itinerary card", () => {
    renderCard(makeActivity("a", { title: "Roque de los Muchachos", origin: "suggested" }));
    expect(screen.getByText("Sugerida")).toBeTruthy();
  });
});
