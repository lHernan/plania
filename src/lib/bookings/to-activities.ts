import type { ActivityCategory, BookingDetails, BookingField, BookingMoment, BookingRole, BookingType, TripDay } from "@/lib/types";
import type { NewActivity } from "@/store/use-itinerary-store";
import type { ExtractedBooking } from "./extract";
import { minutesBetween } from "./timezone";

export type BookingProblem = "missing_start_date" | "outside_trip_dates";

type Lang = "es" | "en";

const WORDS: Record<Lang, {
  types: Record<BookingType, string>;
  roles: Partial<Record<BookingRole, string>>;
  reference: string;
  provider: string;
}> = {
  es: {
    types: {
      flight: "Vuelo",
      lodging: "Alojamiento",
      car_rental: "Alquiler de coche",
      train: "Tren",
      ferry: "Ferry",
      bus: "Autobús",
      transfer: "Traslado",
      ticket: "Entrada",
      other: "Reserva",
    },
    roles: { check_in: "Check-in", check_out: "Check-out", pickup: "Recogida", dropoff: "Devolución" },
    reference: "Localizador",
    provider: "Proveedor",
  },
  en: {
    types: {
      flight: "Flight",
      lodging: "Stay",
      car_rental: "Car rental",
      train: "Train",
      ferry: "Ferry",
      bus: "Bus",
      transfer: "Transfer",
      ticket: "Ticket",
      other: "Booking",
    },
    roles: { check_in: "Check-in", check_out: "Check-out", pickup: "Pickup", dropoff: "Return" },
    reference: "Reference",
    provider: "Provider",
  },
};

const CATEGORY: Record<BookingType, ActivityCategory> = {
  flight: "transport",
  train: "transport",
  ferry: "transport",
  bus: "transport",
  transfer: "transport",
  car_rental: "transport",
  lodging: "hotel",
  ticket: "reservation",
  other: "other",
};

const DEFAULT_TIME: Record<BookingRole, string> = {
  check_in: "15:00",
  check_out: "11:00",
  pickup: "10:00",
  dropoff: "10:00",
  departure: "09:00",
  single: "09:00",
};

const FLIGHT_FALLBACK_MIN = 120;
const SHORT_MIN = 30;
const SINGLE_FALLBACK_MIN = 60;
const MAX_DURATION_MIN = 24 * 60;

type Plan = {
  role: BookingRole;
  moment: "start" | "end";
  location?: string;
  durationMin: number;
};

function plansFor(b: ExtractedBooking): Plan[] {
  const span = b.start && b.end ? minutesBetween(b.start, b.end) : null;
  switch (b.type) {
    case "flight":
      return [{ role: "departure", moment: "start", location: b.from, durationMin: span !== null && span <= MAX_DURATION_MIN ? span : FLIGHT_FALLBACK_MIN }];
    case "lodging":
      return [
        { role: "check_in", moment: "start", location: b.address ?? b.to, durationMin: SHORT_MIN },
        { role: "check_out", moment: "end", location: b.address ?? b.to, durationMin: SHORT_MIN },
      ];
    case "car_rental":
      return [
        { role: "pickup", moment: "start", location: b.pickupLocation ?? b.from, durationMin: SHORT_MIN },
        { role: "dropoff", moment: "end", location: b.dropoffLocation ?? b.to ?? b.pickupLocation, durationMin: SHORT_MIN },
      ];
    default:
      return [{
        role: "single",
        moment: "start",
        location: b.from ?? b.address ?? b.to,
        durationMin: span !== null && span > 0 && span <= MAX_DURATION_MIN ? span : SINGLE_FALLBACK_MIN,
      }];
  }
}

function buildNotes(b: ExtractedBooking, lang: Lang): string | undefined {
  const words = WORDS[lang];
  const lines = [
    b.reference ? `${words.reference}: ${b.reference}` : "",
    b.provider ? `${words.provider}: ${b.provider}` : "",
    b.from && b.to ? `${b.from} → ${b.to}` : "",
    b.details ?? "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}

/**
 * Turns a confirmed booking into the activities that anchor it in the trip (e.g. check-in and
 * check-out). Activities whose date has no trip day are omitted and reported.
 */
export function bookingToActivities(
  b: ExtractedBooking,
  days: TripDay[],
  lang: Lang,
): { activities: NewActivity[]; problems: BookingProblem[] } {
  if (!b.start?.date) return { activities: [], problems: ["missing_start_date"] };

  const { id, warnings: _warnings, ...details } = b;
  void _warnings;
  const words = WORDS[lang];
  const baseTitle = b.title || words.types[b.type];
  const notes = buildNotes(b, lang);
  const activities: NewActivity[] = [];
  const problems: BookingProblem[] = [];

  for (const plan of plansFor(b)) {
    const moment: BookingMoment | undefined = plan.moment === "start" ? b.start : b.end;
    if (!moment?.date) continue;

    const day = days.find((d) => d.date === moment.date);
    if (!day) {
      if (!problems.includes("outside_trip_dates")) problems.push("outside_trip_dates");
      continue;
    }

    const fieldStatus = { ...b.fieldStatus };
    const timeField: BookingField = plan.moment === "start" ? "startTime" : "endTime";
    const timeInferred = !moment.time;
    if (timeInferred) fieldStatus[timeField] = "estimated";
    if (plan.role === "departure" && !(b.end?.time)) fieldStatus.endTime = "estimated";

    const booking: BookingDetails = { ...details, version: 1, role: plan.role, groupId: id, fieldStatus };
    const roleWord = words.roles[plan.role];

    activities.push({
      dayId: day.id,
      city: day.city,
      title: roleWord ? `${roleWord}: ${baseTitle}` : baseTitle,
      time: moment.time ?? DEFAULT_TIME[plan.role],
      durationMin: plan.durationMin,
      ...(notes ? { notes } : {}),
      ...(plan.location ? { location: plan.location } : {}),
      category: CATEGORY[b.type],
      priority: "critical",
      state: "pending",
      sort_order: 0,
      timeInferred,
      origin: "booking",
      booking,
    });
  }

  return { activities, problems };
}
