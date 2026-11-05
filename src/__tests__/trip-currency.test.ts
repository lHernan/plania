// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  },
}));

const { parseTravelContext } = await import("@/lib/travel-context");
const { getTripCurrency, resolvePreferredCurrency, withTripCurrency } = await import("@/lib/trip-currency");

const registered = (preferred?: unknown) =>
  ({ id: "u1", is_anonymous: false, user_metadata: preferred === undefined ? {} : { preferred_currency: preferred } }) as never;

beforeEach(() => window.localStorage.clear());

describe("preferred currency", () => {
  it("prefers the profile metadata, then the stored home currency, then USD", () => {
    window.localStorage.setItem("plania_home_currency", "GBP");
    expect(resolvePreferredCurrency(registered("EUR"))).toBe("EUR");
    expect(resolvePreferredCurrency(registered())).toBe("GBP");
    expect(resolvePreferredCurrency(null)).toBe("GBP");
    window.localStorage.clear();
    expect(resolvePreferredCurrency(registered())).toBe("USD");
  });

  it("ignores invalid codes at every level", () => {
    window.localStorage.setItem("plania_home_currency", "nope");
    expect(resolvePreferredCurrency(registered("XYZW"))).toBe("USD");
  });
});

describe("trip currency", () => {
  it("falls back to the preference for a trip saved without a currency, without changing it", () => {
    const legacy = { version: 1 as const, travelerCount: 2 };
    expect(getTripCurrency(legacy, "GBP")).toBe("GBP");
    expect(getTripCurrency(undefined, "GBP")).toBe("GBP");
    expect(getTripCurrency({ ...legacy, currency: "HUF" }, "GBP")).toBe("HUF");
    expect(legacy).toEqual({ version: 1, travelerCount: 2 });
  });

  it("gives a new trip the preferred currency unless it already has one", () => {
    expect(withTripCurrency(undefined, "EUR")).toEqual({ version: 1, currency: "EUR" });
    expect(withTripCurrency({ version: 1, travelerCount: 3 }, "EUR")).toEqual({ version: 1, travelerCount: 3, currency: "EUR" });
    expect(withTripCurrency({ version: 1, currency: "JPY" }, "EUR")).toEqual({ version: 1, currency: "JPY" });
  });
});

describe("travel context currency", () => {
  it("keeps a valid ISO 4217 currency, normalized to upper case", () => {
    expect(parseTravelContext({ version: 1, currency: " eur " })).toEqual({ version: 1, currency: "EUR" });
  });

  it("rejects an unknown currency", () => {
    expect(parseTravelContext({ version: 1, travelerCount: 2, currency: "EURO" })).toBeNull();
  });

  it("parses contexts without a currency as before", () => {
    expect(parseTravelContext({ version: 1, travelerCount: 2, preferences: { budgetLevel: "low" } }))
      .toEqual({ version: 1, travelerCount: 2, preferences: { budgetLevel: "low" } });
    expect(parseTravelContext({ version: 1 })).toBeNull();
  });
});
