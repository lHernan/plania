import { describe, expect, it } from "vitest";
import { resolveInferredYears } from "@/lib/bookings/year-inference";
import type { ExtractedBooking } from "@/lib/bookings/extract";

// Fake Airbnb-style confirmation: dates without a year, with weekdays.
const AIRBNB_NO_YEAR = [
  "Casa Rural Ejemplo con Wifi",
  "Check-in",
  "2:00 PM",
  "Sat, Oct 31",
  "Checkout",
  "11:00 AM",
  "Mon, Nov 2",
  "Confirmation code",
  "HMFAKE0001",
  "Calle Falsa, 1, Santa Cruz de la Palma, 38700, Spain",
].join("\n");

function lodging(startDate: string, endDate: string): ExtractedBooking {
  return {
    id: "abc-0",
    type: "lodging",
    title: "Casa Rural Ejemplo con Wifi",
    reference: "HMFAKE0001",
    start: { date: startDate, time: "14:00" },
    end: { date: endDate, time: "11:00" },
    fieldStatus: { startDate: "extracted", endDate: "extracted", reference: "extracted", title: "extracted" },
    warnings: [],
  };
}

const trip = { tripStartDate: "2026-10-31", tripEndDate: "2026-11-02", today: "2026-10-27" };

describe("resolveInferredYears", () => {
  it("replaces a guessed year with the trip's year when the document has no year", () => {
    const [fixed] = resolveInferredYears([lodging("2023-10-31", "2023-11-02")], { text: AIRBNB_NO_YEAR, ...trip });
    expect(fixed.start?.date).toBe("2026-10-31");
    expect(fixed.end?.date).toBe("2026-11-02");
  });

  it("marks inferred years as estimated and warns, never as extracted", () => {
    const [fixed] = resolveInferredYears([lodging("2023-10-31", "2023-11-02")], { text: AIRBNB_NO_YEAR, ...trip });
    expect(fixed.fieldStatus.startDate).toBe("estimated");
    expect(fixed.fieldStatus.endDate).toBe("estimated");
    expect(fixed.warnings).toEqual(expect.arrayContaining(["year_inferred:startDate", "year_inferred:endDate"]));
  });

  it("uses the weekday printed in the document when there are no trip dates", () => {
    // Sat Oct 31 and Mon Nov 2 only match 2026 among the nearby years.
    const [fixed] = resolveInferredYears([lodging("2023-10-31", "2023-11-02")], { text: AIRBNB_NO_YEAR, today: "2026-01-15" });
    expect(fixed.start?.date).toBe("2026-10-31");
    expect(fixed.end?.date).toBe("2026-11-02");
  });

  it("understands Spanish weekdays and months", () => {
    const text = "Llegada: sáb., 31 oct\nSalida: lun., 2 nov";
    const [fixed] = resolveInferredYears([lodging("2023-10-31", "2023-11-02")], { text, today: "2026-01-15" });
    expect(fixed.start?.date).toBe("2026-10-31");
  });

  it("keeps the end after the start across a year boundary", () => {
    const text = "Check-in Wed, Dec 30\nCheckout Sat, Jan 2";
    const [fixed] = resolveInferredYears([lodging("2023-12-30", "2023-01-02")], {
      text,
      tripStartDate: "2026-12-30",
      tripEndDate: "2027-01-02",
      today: "2026-11-01",
    });
    expect(fixed.start?.date).toBe("2026-12-30");
    expect(fixed.end?.date).toBe("2027-01-02");
  });

  it("leaves dates untouched when the document states the year", () => {
    const text = AIRBNB_NO_YEAR.replace("Sat, Oct 31", "Sat, Oct 31, 2026").replace("Mon, Nov 2", "Mon, Nov 2, 2026");
    const original = lodging("2026-10-31", "2026-11-02");
    const [fixed] = resolveInferredYears([original], { text, ...trip });
    expect(fixed).toEqual(original);
  });

  it("does not move a year the document explicitly states, even if outside the trip", () => {
    const text = "Check-in Sat, Oct 31, 2027\nCheckout Mon, Nov 2, 2027";
    const original = lodging("2027-10-31", "2027-11-02");
    expect(resolveInferredYears([original], { text, ...trip })[0]).toEqual(original);
  });

  it("without text (scanned pages) only corrects dates that land inside the trip with another year", () => {
    const [fixed] = resolveInferredYears([lodging("2023-10-31", "2023-11-02")], { ...trip });
    expect(fixed.start?.date).toBe("2026-10-31");
    expect(fixed.fieldStatus.startDate).toBe("estimated");

    const unrelated = lodging("2023-05-10", "2023-05-12");
    expect(resolveInferredYears([unrelated], { ...trip })[0]).toEqual(unrelated);
  });

  it("never mutates its input", () => {
    const input = lodging("2023-10-31", "2023-11-02");
    const snapshot = JSON.stringify(input);
    resolveInferredYears([input], { text: AIRBNB_NO_YEAR, ...trip });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("year_inferred warning label", () => {
  it("explains the completed year in the selected language", async () => {
    const { warningLabel } = await import("@/components/booking-import/labels");
    const es = (await import("@/i18n/locales/es.json")).default as Record<string, string>;
    const t = (key: string, vars?: Record<string, string | number>) =>
      Object.entries(vars ?? {}).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), es[key] ?? key);
    const label = warningLabel(t, "year_inferred:startDate");
    expect(label).toMatch(/^El documento no indica el año de /);
    expect(label).not.toContain("year_inferred");
  });
});
