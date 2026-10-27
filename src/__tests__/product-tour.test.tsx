// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";
import { ProductTour, TOUR_SEEN_KEY, useProductTour } from "@/components/ProductTour";
import { TOUR_STEPS } from "@/lib/tour/steps";

function anchors(ids: string[]) {
  return ids.map((id) => <div key={id} data-tour={id} style={{ height: 40 }}>{id}</div>);
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("ProductTour", () => {
  it("walks the visible sections in order and skips the ones not on screen", () => {
    const onClose = vi.fn();
    renderWithI18n(
      <>
        {anchors(["trip-switcher", "day-strip", "timeline", "shopping"])}
        <ProductTour open onClose={onClose} />
      </>,
    );
    const dialog = () => screen.getByRole("dialog");
    // Brand welcome first, always.
    expect(dialog().textContent).toContain("¡Bienvenido a Tachao!");
    expect(dialog().textContent).toContain("1 de 5");
    expect(screen.queryByRole("button", { name: "Atrás" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Empezar" }));
    expect(dialog().textContent).toContain("Tus viajes");

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(dialog().textContent).toContain("Los días");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    // "day-tools" has no anchor here, so the itinerary comes next.
    expect(dialog().textContent).toContain("Tu itinerario");
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(dialog().textContent).toContain("Los días");

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(dialog().textContent).toContain("Lista de compras");
    fireEvent.click(screen.getByRole("button", { name: "¡A tachar!" }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("closes with Skip or Escape", () => {
    const onClose = vi.fn();
    renderWithI18n(<>{anchors(["trip-switcher", "day-strip"])}<ProductTour open onClose={onClose} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Saltar tour" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose.mock.calls).toEqual([[false], [false]]);
  });

  it("explains every section the trip screen marks", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "welcome", "trip-switcher", "day-strip", "day-tools", "timeline", "ai-shortcuts", "reservations", "shopping", "travel-tools", "travel-agent", "share", "tour-help",
    ]);
  });

  it("still welcomes when no section is on screen", () => {
    renderWithI18n(<ProductTour open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog").textContent).toContain("1 de 1");
  });
});

function TourHost({ ready }: { ready: boolean }) {
  const tour = useProductTour(ready);
  return (
    <>
      <button onClick={tour.start}>ayuda</button>
      <span>{tour.open ? "abierto" : "cerrado"}</span>
      <button onClick={() => tour.close()}>cerrar</button>
    </>
  );
}

describe("useProductTour", () => {
  it("starts by itself the first time only, and can be replayed", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<TourHost ready={false} />);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByText("cerrado")).toBeTruthy();

    rerender(<TourHost ready />);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByText("abierto")).toBeTruthy();
    fireEvent.click(screen.getByText("cerrar"));
    expect(window.localStorage.getItem(TOUR_SEEN_KEY)).toBe("1");
    vi.useRealTimers();

    cleanup();
    vi.useFakeTimers();
    render(<TourHost ready />);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByText("cerrado")).toBeTruthy();
    fireEvent.click(screen.getByText("ayuda"));
    expect(screen.getByText("abierto")).toBeTruthy();
    vi.useRealTimers();
  });
});
