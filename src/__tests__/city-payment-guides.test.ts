import { describe, expect, it } from "vitest";
import { findCityPaymentGuide, normalizeGuideCity, type CityPaymentGuide } from "@/lib/city-payment-guides";

describe("city payment guide lookup", () => {
  it("normalizes case, whitespace, and accents for city matching", () => {
    expect(normalizeGuideCity("  São   Paulo ")).toBe("sao paulo");
  });

  it("does not return unsupported city guidance", () => {
    expect(findCityPaymentGuide("Unknown City")).toBeUndefined();
  });

  it("rejects guide facts without secure, checked sources", () => {
    const guide: CityPaymentGuide = {
      city: "Paris",
      country: "France",
      countryCode: "FR",
      facts: [{
        id: "cash",
        mode: "public_transport",
        question: "Can I pay by card?",
        answer: "Yes.",
        sources: [{ label: "Unofficial blog", url: "http://example.test/blog", checkedAt: "2026-10-08" }],
      }],
    };

    expect(findCityPaymentGuide("Paris", [guide])).toBeUndefined();
  });

  it("matches a configured alias and keeps source verification metadata", () => {
    const guides: CityPaymentGuide[] = [{
      city: "Seoul",
      aliases: ["서울"],
      country: "South Korea",
      countryCode: "KR",
      facts: [{
        id: "transit-contactless",
        mode: "public_transport",
        question: "Can I tap a bank card?",
        answer: "Verified answer.",
        sources: [{ label: "Transit authority", url: "https://example.test/official", checkedAt: "2026-10-08" }],
      }],
    }];

    expect(findCityPaymentGuide("서울", guides)?.facts[0]).toMatchObject({
      answer: "Verified answer.",
      sources: [{ label: "Transit authority", checkedAt: "2026-10-08" }],
    });
  });
});
