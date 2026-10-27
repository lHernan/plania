import type { BookingMoment } from "@/lib/types";
import type { ExtractedBooking } from "@/lib/bookings/extract";

/**
 * Many confirmations print dates without a year ("Sat, Oct 31"). Models then fill in a year from
 * their training data. This pass detects years the document never states and resolves them
 * deterministically from the trip dates, the printed weekday and today — and marks them
 * "estimated" with a warning instead of letting them pass as extracted.
 */

export type YearInferenceContext = {
  /** Plain text of the document; absent for scanned (image-only) documents. */
  text?: string;
  tripStartDate?: string;
  tripEndDate?: string;
  /** YYYY-MM-DD */
  today: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** A booking can start a little before or end a little after the trip's planned dates. */
const TRIP_WINDOW_DAYS = 3;
/** Recent past bookings still count as "upcoming" for year resolution. */
const RECENT_PAST_DAYS = 60;

const MONTHS: [RegExp, number][] = [
  [/^(jan|january|ene|enero)$/, 1],
  [/^(feb|february|febrero)$/, 2],
  [/^(mar|march|marzo)$/, 3],
  [/^(apr|april|abr|abril)$/, 4],
  [/^(may|mayo)$/, 5],
  [/^(jun|june|junio)$/, 6],
  [/^(jul|july|julio)$/, 7],
  [/^(aug|august|ago|agosto)$/, 8],
  [/^(sep|sept|september|septiembre|setiembre)$/, 9],
  [/^(oct|october|octubre)$/, 10],
  [/^(nov|november|noviembre)$/, 11],
  [/^(dec|december|dic|diciembre)$/, 12],
];

const WEEKDAYS: [RegExp, number][] = [
  [/^(sun|sunday|dom|domingo)$/, 0],
  [/^(mon|monday|lun|lunes)$/, 1],
  [/^(tue|tues|tuesday|mar|martes)$/, 2],
  [/^(wed|wednesday|mie|miercoles)$/, 3],
  [/^(thu|thur|thurs|thursday|jue|jueves)$/, 4],
  [/^(fri|friday|vie|viernes)$/, 5],
  [/^(sat|saturday|sab|sabado)$/, 6],
];

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const lookup = (table: [RegExp, number][], token: string) => table.find(([re]) => re.test(token))?.[1];

/** Weekday (0 = Sunday) printed next to this month/day, e.g. "Sat, Oct 31" or "sáb., 31 oct". */
export function findPrintedWeekday(text: string, month: number, day: number): number | null {
  const clean = normalize(text);
  const word = "([a-z]+)\\.?";
  const patterns = [
    new RegExp(`${word}\\s*,?\\s+${word}\\s+(\\d{1,2})\\b`, "g"), // Sat, Oct 31
    new RegExp(`${word}\\s*,?\\s+(\\d{1,2})\\s+(?:de\\s+)?${word}`, "g"), // sáb., 31 oct / sábado 31 de octubre
  ];
  for (const [index, re] of patterns.entries()) {
    for (const match of clean.matchAll(re)) {
      const weekday = lookup(WEEKDAYS, match[1]);
      const monthToken = index === 0 ? match[2] : match[3];
      const dayToken = index === 0 ? match[3] : match[2];
      if (weekday === undefined || lookup(MONTHS, monthToken) !== month || Number(dayToken) !== day) continue;
      return weekday;
    }
  }
  return null;
}

const toTime = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const isIsoDate = (value: string | undefined): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toTime(value));
const withYear = (iso: string, year: number) => `${year}${iso.slice(4)}`;
const weekdayOf = (iso: string) => new Date(toTime(iso)).getUTCDay();

function insideTrip(iso: string, ctx: YearInferenceContext): boolean {
  if (!isIsoDate(ctx.tripStartDate) || !isIsoDate(ctx.tripEndDate)) return false;
  const t = toTime(iso);
  return t >= toTime(ctx.tripStartDate) - TRIP_WINDOW_DAYS * DAY_MS && t <= toTime(ctx.tripEndDate) + TRIP_WINDOW_DAYS * DAY_MS;
}

/** Best year for a month/day whose year the document does not state. */
function chooseDate(iso: string, ctx: YearInferenceContext, printedWeekday: number | null): string | null {
  const baseYear = Number((isIsoDate(ctx.tripStartDate) ? ctx.tripStartDate : ctx.today).slice(0, 4));
  const candidates = [baseYear - 1, baseYear, baseYear + 1, baseYear + 2]
    .map((year) => withYear(iso, year))
    .filter(isIsoDate)
    // Feb 29 on a non-leap year rolls over in Date; drop those.
    .filter((candidate) => candidate.slice(5) === iso.slice(5) && new Date(toTime(candidate)).toISOString().slice(0, 10) === candidate);

  const inTrip = candidates.filter((candidate) => insideTrip(candidate, ctx));
  if (inTrip.length > 0) return inTrip[0];

  const notTooOld = (candidate: string) => toTime(candidate) >= toTime(ctx.today) - RECENT_PAST_DAYS * DAY_MS;
  const byWeekday = printedWeekday === null ? [] : candidates.filter((c) => weekdayOf(c) === printedWeekday);
  const pool = byWeekday.length > 0 ? byWeekday : candidates;
  return pool.find(notTooOld) ?? pool[pool.length - 1] ?? null;
}

type DateField = "startDate" | "endDate";

export function resolveInferredYears(bookings: ExtractedBooking[], ctx: YearInferenceContext): ExtractedBooking[] {
  return bookings.map((booking) => {
    let next: ExtractedBooking = booking;
    const inferred: Partial<Record<DateField, boolean>> = {};

    for (const [key, field] of [["start", "startDate"], ["end", "endDate"]] as const) {
      const moment: BookingMoment | undefined = next[key];
      const date = moment?.date;
      if (!isIsoDate(date)) continue;

      const yearStated = ctx.text !== undefined && new RegExp(`\\b${date.slice(0, 4)}\\b`).test(ctx.text);
      let resolved: string | null = null;
      if (ctx.text !== undefined && ctx.text.trim()) {
        if (yearStated) continue;
        const printed = findPrintedWeekday(ctx.text, Number(date.slice(5, 7)), Number(date.slice(8, 10)));
        resolved = chooseDate(date, ctx, printed);
      } else {
        // Scanned documents: only fix a date that clearly belongs to the trip under another year.
        if (insideTrip(date, ctx)) continue;
        const candidate = chooseDate(date, ctx, null);
        if (!candidate || !insideTrip(candidate, ctx)) continue;
        resolved = candidate;
      }
      if (!resolved) continue;

      inferred[field] = true;
      next = {
        ...next,
        [key]: { ...moment, date: resolved },
        fieldStatus: { ...next.fieldStatus, [field]: "estimated" },
        warnings: next.warnings.includes(`year_inferred:${field}`) ? next.warnings : [...next.warnings, `year_inferred:${field}`],
      };
    }

    // Keep the end after the start when its year was inferred (e.g. Dec 30 → Jan 2).
    const start = next.start?.date;
    const end = next.end?.date;
    if (inferred.endDate && isIsoDate(start) && isIsoDate(end) && toTime(end) < toTime(start)) {
      next = { ...next, end: { ...next.end, date: withYear(end, Number(end.slice(0, 4)) + 1) } };
    }
    // A guessed year may have caused "end before start"; drop that warning once it no longer holds.
    const fixedStart = next.start?.date;
    const fixedEnd = next.end?.date;
    const stillReversed = isIsoDate(fixedStart) && isIsoDate(fixedEnd) && toTime(fixedEnd) < toTime(fixedStart);
    if ((inferred.startDate || inferred.endDate) && !stillReversed) {
      next = { ...next, warnings: next.warnings.filter((warning) => warning !== "end_before_start") };
    }
    return next;
  });
}
