import { describe, expect, it } from "vitest";
import { currencyDecimals, formatCents, parseAmountToCents } from "@/lib/expenses/money";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/types";

// Intl separates the amount and the symbol with a non-breaking space; compare with plain spaces.
const plain = (text: string) => text.replace(/ | /g, " ");

describe("expense categories", () => {
  it("lists the seven categories in display order", () => {
    expect(EXPENSE_CATEGORIES).toEqual(["flights", "lodging", "transport", "food", "activities", "shopping", "other"]);
  });
});

describe("currencyDecimals", () => {
  it("uses the minor unit of the currency", () => {
    expect(currencyDecimals("EUR")).toBe(2);
    expect(currencyDecimals("USD")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
  });

  it("falls back to 2 for an invalid code", () => {
    expect(currencyDecimals("nope!")).toBe(2);
  });
});

describe("parseAmountToCents", () => {
  it("parses whole numbers and both decimal separators", () => {
    expect(parseAmountToCents("12", "EUR")).toBe(1200);
    expect(parseAmountToCents("12,5", "EUR")).toBe(1250);
    expect(parseAmountToCents("12.50", "EUR")).toBe(1250);
    expect(parseAmountToCents("0,01", "EUR")).toBe(1);
  });

  it("parses Spanish and English thousands separators", () => {
    expect(parseAmountToCents("1.234,56", "EUR")).toBe(123456);
    expect(parseAmountToCents("1,234.56", "USD")).toBe(123456);
    expect(parseAmountToCents("1.234.567,89", "EUR")).toBe(123456789);
  });

  it("trims spaces and currency symbols", () => {
    expect(parseAmountToCents("  500 € ", "EUR")).toBe(50000);
    expect(parseAmountToCents("$1,234.56", "USD")).toBe(123456);
  });

  it("uses the currency's decimals (JPY has none)", () => {
    expect(parseAmountToCents("1500", "JPY")).toBe(1500);
    expect(parseAmountToCents("1.500", "JPY")).toBe(1500);
    expect(parseAmountToCents("15,5", "JPY")).toBeNull();
  });

  it("rejects empty, invalid, negative and over-precise input", () => {
    expect(parseAmountToCents("", "EUR")).toBeNull();
    expect(parseAmountToCents("   ", "EUR")).toBeNull();
    expect(parseAmountToCents("abc", "EUR")).toBeNull();
    expect(parseAmountToCents("12a", "EUR")).toBeNull();
    expect(parseAmountToCents("-5", "EUR")).toBeNull();
    expect(parseAmountToCents("12,345", "EUR")).toBeNull();
    expect(parseAmountToCents("1,2,3", "EUR")).toBeNull();
  });
});

describe("formatCents", () => {
  it("formats euros the Spanish way", () => {
    expect(plain(formatCents(16667, "EUR", "es-ES"))).toBe("166,67 €");
    expect(plain(formatCents(50000, "EUR", "es-ES"))).toBe("500,00 €");
  });

  it("formats dollars the English way", () => {
    expect(formatCents(123456, "USD", "en-US")).toBe("$1,234.56");
  });

  it("supports negative amounts", () => {
    expect(plain(formatCents(-16667, "EUR", "es-ES"))).toBe("-166,67 €");
    expect(formatCents(-123456, "USD", "en-US")).toBe("-$1,234.56");
  });

  it("formats currencies without decimals", () => {
    expect(formatCents(1500, "JPY", "en-US")).toBe("¥1,500");
  });
});

describe("formatCents signed", () => {
  it("shows the sign of balances when asked", () => {
    expect(plain(formatCents(33333, "EUR", "es-ES", { signed: true }))).toBe("+333,33 €");
    expect(plain(formatCents(-16667, "EUR", "es-ES", { signed: true }))).toBe("-166,67 €");
    expect(plain(formatCents(0, "EUR", "es-ES", { signed: true }))).toBe("0,00 €");
  });
});
