// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { mockMatchMedia } from "./helpers/dom";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";

describe("useMediaQuery", () => {
  it("reports desktop when the lg breakpoint matches", () => {
    mockMatchMedia((q) => q === DESKTOP_QUERY);
    expect(renderHook(() => useMediaQuery(DESKTOP_QUERY)).result.current).toBe(true);
  });

  it("reports mobile when the lg breakpoint does not match", () => {
    mockMatchMedia(() => false);
    expect(renderHook(() => useMediaQuery(DESKTOP_QUERY)).result.current).toBe(false);
  });

  it("uses Tailwind's lg breakpoint", () => {
    expect(DESKTOP_QUERY).toBe("(min-width: 1024px)");
  });
});
