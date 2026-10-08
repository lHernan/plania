import type { ArrivalOption, ArrivalTransportMode, TravelContext } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

function optionalCount(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 50) return null;
  return value;
}

function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const ARRIVAL_MODES: ArrivalTransportMode[] = ["public_transport", "taxi", "ride_hailing", "private_transfer", "other"];
const CURRENCY_FALLBACK = new Set(["EUR", "USD", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "INR", "MXN", "BRL"]);

function optionalInteger(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== "string" || value.trim().length !== 3) return undefined;
  const code = value.trim().toUpperCase();
  const supported = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency")
    : [...CURRENCY_FALLBACK];
  return supported.includes(code) ? code : undefined;
}

export function getCurrencyFractionDigits(currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function parseArrivalOption(value: unknown): ArrivalOption | null {
  const source = asRecord(value);
  if (!source) return null;

  const id = optionalText(source.id, 80);
  const name = optionalText(source.name, 120);
  const mode = source.mode;
  const amount = source.amount;
  const priceBasis = source.priceBasis;
  const vehicleCapacity = optionalInteger(source.vehicleCapacity, 1, 50);
  const luggageCapacity = optionalInteger(source.luggageCapacity, 1, 100);
  const currency = normalizeCurrency(source.currency);
  const durationMin = optionalInteger(source.durationMin, 1, 1_440);
  const transfers = optionalInteger(source.transfers, 0, 30);
  const walkingMin = optionalInteger(source.walkingMin, 0, 1_440);
  const comfortScore = optionalInteger(source.comfortScore, 1, 5);
  const provider = optionalText(source.source, 240);
  const checkedAt = optionalText(source.sourceCheckedAt, 40);
  const currencyDigits = currency ? getCurrencyFractionDigits(currency) : 2;
  const amountScale = 10 ** currencyDigits;

  if (
    !id || !name || !ARRIVAL_MODES.includes(mode as ArrivalTransportMode) ||
    typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000 ||
    Math.abs(amount * amountScale - Math.round(amount * amountScale)) > 1e-7 ||
    (priceBasis !== "per_person" && priceBasis !== "whole_group" && priceBasis !== "per_vehicle") ||
    vehicleCapacity === null || luggageCapacity === null ||
    (priceBasis === "per_vehicle" && vehicleCapacity === undefined) ||
    !currency || !/^[A-Z]{3}$/.test(currency) ||
    durationMin === undefined || durationMin === null ||
    transfers === null || walkingMin === null || comfortScore === null ||
    !provider || !checkedAt || !Number.isFinite(Date.parse(checkedAt)) ||
    typeof source.isEstimate !== "boolean"
  ) return null;

  return {
    id,
    name,
    mode: mode as ArrivalTransportMode,
    amount,
    priceBasis,
    vehicleCapacity,
    luggageCapacity,
    currency,
    durationMin,
    transfers,
    walkingMin,
    comfortScore,
    source: provider,
    sourceCheckedAt: new Date(checkedAt).toISOString(),
    isEstimate: source.isEstimate,
    notes: optionalText(source.notes, 500),
  };
}

export function parseTravelContext(value: unknown): TravelContext | null {
  const source = asRecord(value);
  if (!source || source.version !== 1) return null;

  const result: TravelContext = { version: 1 };
  if (source.shareWithAI !== undefined && typeof source.shareWithAI !== "boolean") return null;
  if (typeof source.shareWithAI === "boolean") result.shareWithAI = source.shareWithAI;

  const travelerCount = optionalCount(source.travelerCount);
  if (travelerCount === null || (travelerCount !== undefined && travelerCount < 1)) return null;
  if (travelerCount !== undefined) result.travelerCount = travelerCount;

  const luggage = asRecord(source.luggage);
  if (luggage) {
    const carryOnBags = optionalCount(luggage.carryOnBags);
    const checkedBags = optionalCount(luggage.checkedBags);
    if (carryOnBags === null || checkedBags === null) return null;
    if (carryOnBags !== undefined || checkedBags !== undefined) {
      result.luggage = { carryOnBags, checkedBags };
    }
  }

  const arrival = asRecord(source.arrival);
  if (arrival) {
    const location = optionalText(arrival.location, 240);
    const localDate = optionalText(arrival.localDate, 10);
    const localTime = optionalText(arrival.localTime, 5);
    const timeZone = optionalText(arrival.timeZone, 64);
    if (localDate && !isValidDate(localDate)) return null;
    if (localTime && !isValidTime(localTime)) return null;
    if (timeZone && !isValidTimeZone(timeZone)) return null;
    if (location || localDate || localTime || timeZone) {
      result.arrival = { location, localDate, localTime, timeZone };
    }
  }

  const hotel = asRecord(source.hotel);
  if (hotel) {
    const name = optionalText(hotel.name, 160);
    const address = optionalText(hotel.address, 300);
    const checkIn = optionalText(hotel.checkIn, 5);
    const checkOut = optionalText(hotel.checkOut, 5);
    if ((checkIn && !isValidTime(checkIn)) || (checkOut && !isValidTime(checkOut))) return null;
    if (name || address || checkIn || checkOut) result.hotel = { name, address, checkIn, checkOut };
  }

  const preferences = asRecord(source.preferences);
  if (preferences) {
    const budgetLevel = preferences.budgetLevel;
    if (budgetLevel !== undefined && budgetLevel !== "low" && budgetLevel !== "medium" && budgetLevel !== "high") {
      return null;
    }
    if (
      (preferences.minimizeWalking !== undefined && typeof preferences.minimizeWalking !== "boolean") ||
      (preferences.avoidTransfers !== undefined && typeof preferences.avoidTransfers !== "boolean")
    ) return null;
    const normalizedPreferences: NonNullable<TravelContext["preferences"]> = {};
    if (typeof preferences.minimizeWalking === "boolean") normalizedPreferences.minimizeWalking = preferences.minimizeWalking;
    if (typeof preferences.avoidTransfers === "boolean") normalizedPreferences.avoidTransfers = preferences.avoidTransfers;
    if (budgetLevel === "low" || budgetLevel === "medium" || budgetLevel === "high") {
      normalizedPreferences.budgetLevel = budgetLevel;
    }
    if (Object.keys(normalizedPreferences).length > 0) result.preferences = normalizedPreferences;
  }

  if (source.arrivalOptions !== undefined) {
    if (!Array.isArray(source.arrivalOptions) || source.arrivalOptions.length > 12) return null;
    const options = source.arrivalOptions.map(parseArrivalOption);
    if (options.some((option) => option === null)) return null;
    const normalizedOptions = options as ArrivalOption[];
    if (new Set(normalizedOptions.map((option) => option.id)).size !== normalizedOptions.length) return null;
    if (normalizedOptions.length > 0) result.arrivalOptions = normalizedOptions;
  }

  return Object.keys(result).length > 1 ? result : null;
}

export function getCurrentTripDateTime(now: Date, timeZone?: string) {
  const hasTripTimeZone = Boolean(timeZone && isValidTimeZone(timeZone));
  const effectiveTimeZone = hasTripTimeZone ? timeZone! : "UTC";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: effectiveTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
    timeZone: effectiveTimeZone,
    timeZoneSource: hasTripTimeZone ? "trip_context" as const : "utc_fallback" as const,
  };
}
