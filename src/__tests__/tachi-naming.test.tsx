// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { mockMatchMedia } from "./helpers/dom";
import { TachiAvatar } from "@/components/TachiAvatar";

afterEach(cleanup);

// Former names of the AI features; Tachi is the only one left.
const FORMER_NAMES = /genius|genio|genie|agente de viaje|travel agent|copiloto|copilot/i;

describe("Tachi is the only name of the AI", () => {
  it.each([["es", es], ["en", en]] as const)("no %s text uses a former AI name", (_lang, dict) => {
    const offending = Object.entries(dict as Record<string, string>).filter(([, value]) => FORMER_NAMES.test(value));
    expect(offending).toEqual([]);
  });

  it("names the agent and the day planner after Tachi", () => {
    expect(es.travel_agent).toBe("Tachi");
    expect(en.travel_agent).toBe("Tachi");
    expect(es.open_travel_agent).toBe("¡Pregúntale a Tachi!");
    expect(en.open_travel_agent).toBe("Ask Tachi!");
    expect(es.day_genius).toBe("Reorganizar el día");
    expect(en.day_genius).toBe("Rearrange the day");
  });
});

describe("TachiAvatar", () => {
  it("is one decorative inline icon with its state", () => {
    mockMatchMedia();
    const { container } = render(<TachiAvatar state="thinking" />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("data-state")).toBe("thinking");
    expect(container.querySelector("img")).toBeNull();
  });

  it("only animates while thinking, and never with reduced motion", () => {
    mockMatchMedia();
    const idle = render(<TachiAvatar state="idle" />).container.querySelector("svg") as SVGElement;
    expect(idle.getAttribute("class")).not.toContain("animate-");
    cleanup();
    const thinking = render(<TachiAvatar state="thinking" />).container.querySelector("svg") as SVGElement;
    expect(thinking.getAttribute("class")).toContain("motion-safe:animate-");
  });
});
