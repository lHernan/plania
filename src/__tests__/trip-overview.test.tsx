// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, renderWithI18n } from "./helpers/dom";
import { TripOverview } from "@/components/TripOverview";
import type { CriticalReservation, TripPlan } from "@/lib/types";

afterEach(cleanup);

function reservation(id: string, status: CriticalReservation["status"]): CriticalReservation {
  return { id, title: id, bookingDeadline: "2026-10-01", reservationDate: "2026-10-26", urgency: "safe", status, userId: "u" };
}

function trip(overrides: Partial<TripPlan> = {}): TripPlan {
  const tokyo = makeDay("d1", [makeActivity("a1")]);
  const kyoto = { ...makeDay("d2", []), date: "2026-10-27", city: "Kyoto" };
  const tokyoAgain = { ...makeDay("d3", [makeActivity("a3")]), date: "2026-10-28" };
  const placeholder = { ...makeDay("d4", [makeActivity("a4")]), date: "2026-10-29", city: "New destination" };
  return {
    ...makeTrip([tokyo, kyoto, tokyoAgain, placeholder]),
    id: "t",
    name: "Japan",
    startDate: "2026-10-26",
    endDate: "2026-10-29",
    travelContext: { version: 1, travelerCount: 3 },
    criticalReservations: [reservation("r1", "pending"), reservation("r2", "booked"), reservation("r3", "pending")],
    ...overrides,
  };
}

const callbacks = { onEditContext: vi.fn(), onShare: vi.fn() };

function renderOverview(plan: TripPlan = trip(), { canShare = true, lang = "es" as "es" | "en" } = {}) {
  return renderWithI18n(
    <TripOverview
      trip={plan}
      canShare={canShare}
      {...callbacks}
      budget={<div data-testid="budget" />}
      packing={<div data-testid="packing" />}
      shopping={<div data-testid="shopping" />}
      tools={<div data-testid="tools" />}
    />,
    lang,
  );
}

describe("TripOverview tabs", () => {
  it("shows four tabs with the summary selected and its panel labelled by it", () => {
    renderOverview();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Resumen", "Maleta", "Compras", "Herramientas"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0].id);
    expect(tabs[0].getAttribute("aria-controls")).toBe(panel.id);
  });

  it("each tab shows its block", () => {
    renderOverview();
    fireEvent.click(screen.getByRole("tab", { name: "Maleta" }));
    expect(within(screen.getByRole("tabpanel")).getByTestId("packing")).toBeTruthy();
    expect(screen.queryByTestId("budget")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Compras" }));
    expect(within(screen.getByRole("tabpanel")).getByTestId("shopping")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Herramientas" }));
    expect(within(screen.getByRole("tabpanel")).getByTestId("tools")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Herramientas" }).getAttribute("aria-selected")).toBe("true");
  });

  it("moves between tabs with the arrow keys", () => {
    renderOverview();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Resumen" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Maleta" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Maleta" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Resumen" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Herramientas" }).getAttribute("aria-selected")).toBe("true");
  });

  it("labels the tabs in English", () => {
    renderOverview(trip(), { lang: "en" });
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Summary", "Packing", "Shopping", "Tools"]);
  });
});

describe("TripOverview summary", () => {
  it("shows the name, dates, unique cities without placeholders and travelers", () => {
    renderOverview();
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Japan" })).toBeTruthy();
    expect(within(panel).getByText("26 oct 2026 – 29 oct 2026")).toBeTruthy();
    expect(within(panel).getByText("Tokyo · Kyoto")).toBeTruthy();
    expect(within(panel).getByText("3 viajeros")).toBeTruthy();
    expect(within(panel).getByTestId("budget")).toBeTruthy();
    // AI shortcuts moved to Tachi: the summary no longer carries them.
    expect(within(panel).queryByText("Acciones rápidas con IA")).toBeNull();
  });

  it("says the trip has no dates and asks for the context when they are missing", () => {
    renderOverview(trip({ startDate: undefined, endDate: undefined, travelContext: undefined }));
    expect(screen.getByText("4 días, sin fechas")).toBeTruthy();
    expect(screen.queryByText(/viajeros/)).toBeNull();
    expect(screen.getByText("Cuéntanos cuántos viajan y con qué equipaje para afinar las sugerencias.")).toBeTruthy();
  });

  it("opens the trip context editor and the share dialog", () => {
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: "Editar contexto del viaje" }));
    expect(callbacks.onEditContext).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));
    expect(callbacks.onShare).toHaveBeenCalled();
  });

  it("hides sharing from invitees", () => {
    renderOverview(trip(), { canShare: false });
    expect(screen.queryByRole("button", { name: "Compartir" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar contexto del viaje" })).toBeTruthy();
  });
});

describe("TripOverview preparation checklist", () => {
  it("links pending reservations to the wallet and empty days to the itinerary on that day", () => {
    renderOverview();
    const list = screen.getByRole("list", { name: "Preparación" });
    expect(within(list).getByRole("link", { name: "2 reservas por hacer" }).getAttribute("href")).toBe("/trips/t/wallet");
    expect(within(list).getByRole("link", { name: /Kyoto: sin actividades/ }).getAttribute("href")).toBe(
      "/trips/t?day=2026-10-27",
    );
  });

  it("marks reservations and days as ready when nothing is pending", () => {
    const plan = trip({ criticalReservations: [reservation("r2", "booked")] });
    plan.days = plan.days.filter((d) => d.activities.length > 0);
    renderOverview(plan);
    const list = screen.getByRole("list", { name: "Preparación" });
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
    expect(within(list).getByText("Reservas al día")).toBeTruthy();
    expect(within(list).getByText("Todos los días tienen planes")).toBeTruthy();
  });

  it("writes the checklist in English", () => {
    renderOverview(trip(), { lang: "en" });
    const list = screen.getByRole("list", { name: "Preparation" });
    expect(within(list).getByRole("link", { name: "2 bookings to make" })).toBeTruthy();
    expect(within(list).getByRole("link", { name: /Kyoto: no activities/ })).toBeTruthy();
  });
});
