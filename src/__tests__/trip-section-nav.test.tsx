// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({ pathname: "/trips/t1", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const { TripSectionNav, tripSectionHref } = await import("@/components/TripSectionNav");

beforeEach(() => {
  mockMatchMedia();
  nav.pathname = "/trips/t1";
  nav.search = "";
});
afterEach(() => cleanup());

function links() {
  return within(screen.getByRole("navigation")).getAllByRole("link");
}

describe("TripSectionNav", () => {
  it.each(["bar", "tabs"] as const)("links the four sections of the trip (%s)", (variant) => {
    renderWithI18n(<TripSectionNav tripId="t1" variant={variant} />);
    expect(links().map((a) => a.getAttribute("href"))).toEqual([
      "/trips/t1",
      "/trips/t1/map",
      "/trips/t1/wallet",
      "/trips/t1/overview",
    ]);
  });

  it("keeps the selected day when switching sections", () => {
    nav.search = "day=2026-10-26";
    renderWithI18n(<TripSectionNav tripId="t1" variant="bar" />);
    expect(links().map((a) => a.getAttribute("href"))).toEqual([
      "/trips/t1?day=2026-10-26",
      "/trips/t1/map?day=2026-10-26",
      "/trips/t1/wallet?day=2026-10-26",
      "/trips/t1/overview?day=2026-10-26",
    ]);
  });

  it("marks only the current section as the current page", () => {
    nav.pathname = "/trips/t1/wallet";
    renderWithI18n(<TripSectionNav tripId="t1" variant="tabs" />);
    const current = links().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe("/trips/t1/wallet");
  });

  it("treats the trip path itself as the itinerary", () => {
    renderWithI18n(<TripSectionNav tripId="t1" variant="bar" />);
    expect(screen.getByRole("link", { current: "page" }).getAttribute("href")).toBe("/trips/t1");
  });

  it("shows visible labels in Spanish", () => {
    renderWithI18n(<TripSectionNav tripId="t1" variant="bar" />, "es");
    expect(links().map((a) => a.textContent)).toEqual(["Itinerario", "Mapa", "Cartera", "Viaje"]);
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("Secciones del viaje");
  });

  it("shows visible labels in English", () => {
    renderWithI18n(<TripSectionNav tripId="t1" variant="tabs" />, "en");
    expect(links().map((a) => a.textContent)).toEqual(["Itinerary", "Map", "Wallet", "Trip"]);
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("Trip sections");
  });

  it("gives every item a touch target of at least 44 px", () => {
    for (const variant of ["bar", "tabs"] as const) {
      renderWithI18n(<TripSectionNav tripId="t1" variant={variant} />);
      for (const link of links()) {
        expect(link.className).toMatch(/\bmin-h-11\b/);
        expect(link.className).toMatch(/\bmin-w-11\b/);
      }
      cleanup();
    }
  });

  it("shows the bar only on mobile and the tabs only on desktop", () => {
    renderWithI18n(<TripSectionNav tripId="t1" variant="bar" />);
    expect(screen.getByRole("navigation").className).toMatch(/\bmd:hidden\b/);
    expect(screen.getByRole("navigation").className).toMatch(/\bfixed\b/);
    cleanup();
    renderWithI18n(<TripSectionNav tripId="t1" variant="tabs" />);
    expect(screen.getByRole("navigation").className).toMatch(/\bhidden\b.*\bmd:flex\b/);
  });
});

describe("tripSectionHref", () => {
  it("builds the section path with the day, or without it when there is none", () => {
    expect(tripSectionHref("t1", "map", "2026-10-26")).toBe("/trips/t1/map?day=2026-10-26");
    expect(tripSectionHref("t1", "itinerary", null)).toBe("/trips/t1");
    expect(tripSectionHref("a b", "wallet")).toBe("/trips/a%20b/wallet");
  });
});
