import type { Activity, ArrivalOption, TravelContext, TripDay } from "@/lib/types";
import { getCurrencyFractionDigits } from "@/lib/travel-context";

export type ArrivalCriterion = "price" | "duration" | "comfort" | "walking" | "transfers";

export type ArrivalComparison = {
  options: Array<{
    option: ArrivalOption;
    totalGroupCost: number | null;
    vehiclesRequired?: number;
    score: number | null;
  }>;
  recommendationId?: string;
  criteria: ArrivalCriterion[];
  unavailableReason?: "need_two_options" | "traveler_count_required" | "vehicle_capacity_required" | "currency_mismatch";
  reason?: {
    cheapestOptionId: string;
    recommendedTotal: number;
    cheapestTotal: number;
    recommendedDurationMin: number;
    cheapestDurationMin: number;
    criteria: ArrivalCriterion[];
  };
};

export type HotelArrivalEstimate = {
  arrivalDate: string;
  arrivalTime: string;
  checkInTime: string;
  relationToCheckIn: "early" | "at_check_in" | "after_check_in";
  differenceMin: number;
  timeZone: string;
};

export type HotelCheckInSource = {
  time: string;
  source: "itinerary" | "travel_context";
  activityTitle?: string;
};

export type HotelArrivalStop = {
  id: string;
  date: string;
  title: string;
  destination: string;
  scheduledTime: string;
  checkInTime?: string;
  checkInSource?: "itinerary" | "travel_context";
  origin?: string;
  originSource?: "previous_activity" | "previous_hotel" | "trip_arrival";
};

export function getHotelArrivalStopsForDay(stops: HotelArrivalStop[], activeDate?: string) {
  return activeDate ? stops.filter((stop) => stop.date === activeDate) : [];
}

const isScheduledCheckIn = (activity: Activity) =>
  activity.category === "hotel" &&
  activity.state !== "skipped" &&
  /^(?:(?:hotel|hostel)\s+)?check[\s-]?in\b|^registro(?:\s+(?:en\s+(?:el\s+)?)?(?:hotel|hostal))?\b/i.test(activity.title.trim()) &&
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(activity.time);

export function resolveHotelCheckIn(context: TravelContext | undefined, days: TripDay[]): HotelCheckInSource | undefined {
  const arrivalDate = context?.arrival?.localDate;
  const checkInDays = arrivalDate ? days.filter((day) => day.date === arrivalDate) : days;
  const matches = checkInDays.flatMap((day) => day.activities.map((activity) => ({ day, activity })))
    .filter(({ activity }) => isScheduledCheckIn(activity));
  const matchingTimes = new Set(matches.map(({ activity }) => activity.time));
  const matchingDates = new Set(matches.map(({ day }) => day.date));
  if (matchingTimes.size === 1 && matchingDates.size === 1 && matches.length > 0) {
    const match = matches[0].activity;
    return { time: match.time, source: "itinerary", activityTitle: match.title };
  }

  return context?.hotel?.checkIn
    ? { time: context.hotel.checkIn, source: "travel_context" }
    : undefined;
}

export function resolveHotelDestination(context: TravelContext | undefined, days: TripDay[]) {
  const profileDestination = context?.hotel?.address || context?.hotel?.name;
  if (profileDestination) return profileDestination;

  const arrivalDate = context?.arrival?.localDate;
  let hotelDays = arrivalDate ? days.filter((day) => day.date === arrivalDate) : days;
  if (!arrivalDate) {
    const candidateDates = new Set(hotelDays
      .filter((day) => day.activities.some((activity) => activity.category === "hotel" && activity.state !== "skipped"))
      .map((day) => day.date));
    if (candidateDates.size !== 1) return undefined;
    hotelDays = hotelDays.filter((day) => candidateDates.has(day.date));
  }

  const hotelActivities = hotelDays.flatMap((day) => day.activities)
    .filter((activity) => activity.category === "hotel" && activity.state !== "skipped")
    .sort((left, right) => left.time.localeCompare(right.time));
  const scheduledCheckIn = hotelActivities.find(isScheduledCheckIn);
  const activity = scheduledCheckIn ?? hotelActivities[0];
  return activity?.location?.trim() || activity?.title.trim() || undefined;
}

function isHotelCheckInStop(activity: Activity) {
  return activity.category === "hotel" &&
    activity.state !== "skipped" &&
    activity.state !== "completed" &&
    /check[\s-]?in|registro/i.test(activity.title);
}

function destinationFromCheckInTitle(title: string) {
  const destination = title
    .trim()
    .replace(/^(?:.*?\+\s*)?(?:hotel\s+)?check[\s-]?in(?:\s+(?:at|in|en|a|del|de la|el|the))?\s*/i, "")
    .trim();
  return destination || title.trim();
}

function previousActivityOrigin(day: TripDay, activity: Activity) {
  return [...day.activities]
    .filter((candidate) => candidate.id !== activity.id && candidate.time < activity.time && candidate.state !== "skipped" && candidate.state !== "completed" && candidate.location?.trim())
    .sort((left, right) => right.time.localeCompare(left.time))[0];
}

export function resolveHotelArrivalStops(context: TravelContext | undefined, days: TripDay[]): HotelArrivalStop[] {
  const stops = days
    .flatMap((day) => day.activities.filter(isHotelCheckInStop).map((activity) => ({ day, activity })))
    .sort((left, right) => left.day.date.localeCompare(right.day.date) || left.activity.time.localeCompare(right.activity.time));
  if (stops.length === 0) {
    const destination = context?.hotel?.address || context?.hotel?.name;
    if (!context?.arrival?.location || !destination) return [];
    return [{
      id: "travel-context-arrival",
      date: context.arrival.localDate ?? "",
      title: destination,
      destination,
      scheduledTime: context.arrival.localTime ?? "",
      checkInTime: context.hotel?.checkIn,
      checkInSource: context.hotel?.checkIn ? "travel_context" : undefined,
      origin: context.arrival.location,
      originSource: "trip_arrival",
    }];
  }
  const firstArrivalStopId = stops.find((stop) => stop.day.date === context?.arrival?.localDate)?.activity.id;

  return stops.map(({ day, activity }) => {
    const explicitCheckIn = isScheduledCheckIn(activity);
    const previous = previousActivityOrigin(day, activity);
    const previousHotel = [...stops]
      .filter((candidate) => candidate.day.date < day.date || (candidate.day.date === day.date && candidate.activity.time < activity.time))
      .sort((left, right) => right.day.date.localeCompare(left.day.date) || right.activity.time.localeCompare(left.activity.time))[0];
    const usesArrivalOrigin = !previous && !previousHotel && context?.arrival?.localDate === day.date && Boolean(context.arrival.location);
    const useProfileHotel = stops.length === 1 || activity.id === firstArrivalStopId;
    const checkInTime = explicitCheckIn
      ? activity.time
      : useProfileHotel
        ? context?.hotel?.checkIn
        : undefined;
    const profileDestination = useProfileHotel
      ? context?.hotel?.address || context?.hotel?.name
      : undefined;

    return {
      id: activity.id,
      date: day.date,
      title: activity.title,
      destination: activity.location?.trim() || profileDestination || destinationFromCheckInTitle(activity.title),
      scheduledTime: activity.time,
      checkInTime,
      checkInSource: explicitCheckIn ? "itinerary" : checkInTime ? "travel_context" : undefined,
      origin: previous?.location?.trim() || previousHotel?.activity.location?.trim() || (previousHotel ? destinationFromCheckInTitle(previousHotel.activity.title) : undefined) || (usesArrivalOrigin ? context?.arrival?.location : undefined),
      originSource: previous ? "previous_activity" : previousHotel ? "previous_hotel" : usesArrivalOrigin ? "trip_arrival" : undefined,
    };
  });
}

function groupCost(option: ArrivalOption, context?: TravelContext) {
  const roundToCurrency = (amount: number) => {
    const scale = 10 ** getCurrencyFractionDigits(option.currency);
    return Math.round((amount + Number.EPSILON) * scale) / scale;
  };
  if (option.priceBasis === "whole_group") return { total: roundToCurrency(option.amount) };
  if (!context?.travelerCount) return { total: null };
  if (option.priceBasis === "per_person") {
    return { total: roundToCurrency(option.amount * context.travelerCount) };
  }

  const carryOnBags = context.luggage?.carryOnBags;
  const checkedBags = context.luggage?.checkedBags;
  if (
    !option.vehicleCapacity ||
    carryOnBags === undefined ||
    checkedBags === undefined ||
    ((carryOnBags + checkedBags) > 0 && !option.luggageCapacity)
  ) return { total: null };

  const passengerVehicles = Math.ceil(context.travelerCount / option.vehicleCapacity);
  const luggageVehicles = Math.ceil((carryOnBags + checkedBags) / (option.luggageCapacity ?? 1));
  const vehiclesRequired = Math.max(passengerVehicles, luggageVehicles, 1);
  return { total: roundToCurrency(option.amount * vehiclesRequired), vehiclesRequired };
}

export function compareArrivalOptions(
  options: ArrivalOption[],
  context?: TravelContext,
): ArrivalComparison {
  const evaluated = options.map((option) => {
    const cost = groupCost(option, context);
    return {
      option,
      totalGroupCost: cost.total,
      vehiclesRequired: cost.vehiclesRequired,
      score: null as number | null,
    };
  });
  const result: ArrivalComparison = { options: evaluated, criteria: [] };

  if (options.length < 2) {
    result.unavailableReason = "need_two_options";
    return result;
  }
  if (!context?.travelerCount) {
    result.unavailableReason = "traveler_count_required";
    return result;
  }
  if (options.some((option, index) => option.priceBasis === "per_vehicle" && evaluated[index].totalGroupCost === null)) {
    result.unavailableReason = "vehicle_capacity_required";
    return result;
  }
  if (new Set(options.map((option) => option.currency)).size > 1) {
    result.unavailableReason = "currency_mismatch";
    return result;
  }

  const weights: Record<ArrivalCriterion, number> = {
    price: 0.3,
    duration: 0.25,
    comfort: 0.2,
    walking: 0.15,
    transfers: 0.1,
  };
  const preferences = context.preferences;
  if (preferences?.budgetLevel === "low") {
    weights.price += 0.1;
    weights.comfort -= 0.1;
  } else if (preferences?.budgetLevel === "high") {
    weights.price -= 0.1;
    weights.comfort += 0.1;
  }
  if (preferences?.minimizeWalking) {
    weights.price -= 0.1;
    weights.walking += 0.1;
  }
  if (preferences?.avoidTransfers) {
    weights.price -= 0.1;
    weights.transfers += 0.1;
  }

  const values: Record<ArrivalCriterion, number[]> = {
    price: evaluated.map((item) => item.totalGroupCost!),
    duration: options.map((option) => option.durationMin),
    comfort: options.map((option) => option.comfortScore ?? Number.NaN),
    walking: options.map((option) => option.walkingMin ?? Number.NaN),
    transfers: options.map((option) => option.transfers ?? Number.NaN),
  };
  const lowerIsBetter: Record<ArrivalCriterion, boolean> = {
    price: true,
    duration: true,
    comfort: false,
    walking: true,
    transfers: true,
  };
  const criteria = (Object.keys(weights) as ArrivalCriterion[])
    .filter((criterion) => weights[criterion] > 0 && values[criterion].every(Number.isFinite));
  const totalWeight = criteria.reduce((sum, criterion) => sum + weights[criterion], 0);
  result.criteria = criteria;

  if (criteria.length === 0 || totalWeight === 0) {
    result.unavailableReason = "need_two_options";
    return result;
  }

  for (const criterion of criteria) {
    const metricValues = values[criterion];
    const minimum = Math.min(...metricValues);
    const maximum = Math.max(...metricValues);
    const utilities = metricValues.map((value) => {
      if (minimum === maximum) return 1;
      return lowerIsBetter[criterion]
        ? (maximum - value) / (maximum - minimum)
        : (value - minimum) / (maximum - minimum);
    });

    for (let index = 0; index < evaluated.length; index += 1) {
      const currentScore = evaluated[index].score ?? 0;
      evaluated[index].score = currentScore + (utilities[index] * weights[criterion] / totalWeight) * 100;
    }
  }

  const ranked = [...evaluated].sort((left, right) =>
    (right.score ?? 0) - (left.score ?? 0) ||
    (left.totalGroupCost ?? 0) - (right.totalGroupCost ?? 0) ||
    left.option.durationMin - right.option.durationMin
  );
  const recommended = ranked[0];
  const cheapest = [...evaluated].sort((left, right) =>
    (left.totalGroupCost ?? 0) - (right.totalGroupCost ?? 0) ||
    left.option.durationMin - right.option.durationMin
  )[0];

  result.recommendationId = recommended.option.id;
  result.reason = {
    cheapestOptionId: cheapest.option.id,
    recommendedTotal: recommended.totalGroupCost!,
    cheapestTotal: cheapest.totalGroupCost!,
    recommendedDurationMin: recommended.option.durationMin,
    cheapestDurationMin: cheapest.option.durationMin,
    criteria,
  };
  return result;
}

type LocalDateTimeParts = { year: number; month: number; day: number; hour: number; minute: number };

function localPartsToEpoch(parts: LocalDateTimeParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function formatInTimeZone(epoch: number, timeZone: string): LocalDateTimeParts {
  const values = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epoch));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((value) => value.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

function localDateTimeToEpoch(localDate: string, localTime: string, timeZone: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!dateMatch || !timeMatch) return null;

  const target: LocalDateTimeParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  const targetEpoch = localPartsToEpoch(target);
  const normalizedTarget = formatInTimeZone(targetEpoch, "UTC");
  if (
    !Number.isFinite(targetEpoch) ||
    normalizedTarget.year !== target.year ||
    normalizedTarget.month !== target.month ||
    normalizedTarget.day !== target.day ||
    normalizedTarget.hour !== target.hour ||
    normalizedTarget.minute !== target.minute
  ) return null;

  let candidate = targetEpoch;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = formatInTimeZone(candidate, timeZone);
    const difference = targetEpoch - localPartsToEpoch(actual);
    if (difference === 0) {
      const duplicateOffsets = [-120, -90, -60, -30, 30, 60, 90, 120];
      const isAmbiguous = duplicateOffsets.some((offsetMin) => {
        const nearby = formatInTimeZone(candidate + offsetMin * 60_000, timeZone);
        return localPartsToEpoch(nearby) === targetEpoch;
      });
      return isAmbiguous ? null : candidate;
    }
    candidate += difference;
  }
  return null;
}

export function estimateHotelArrival(context: TravelContext | undefined, option: ArrivalOption): HotelArrivalEstimate | null {
  const arrival = context?.arrival;
  const checkInTime = context?.hotel?.checkIn;
  const timeZone = arrival?.timeZone;
  if (!arrival?.localDate || !arrival.localTime || !timeZone || !checkInTime) return null;

  try {
    const departure = localDateTimeToEpoch(arrival.localDate, arrival.localTime, timeZone);
    const checkIn = localDateTimeToEpoch(arrival.localDate, checkInTime, timeZone);
    if (departure === null || checkIn === null) return null;

    const estimatedArrivalEpoch = departure + option.durationMin * 60_000;
    const estimatedArrival = formatInTimeZone(estimatedArrivalEpoch, timeZone);
    const difference = Math.round((checkIn - estimatedArrivalEpoch) / 60_000);

    return {
      arrivalDate: `${estimatedArrival.year}-${String(estimatedArrival.month).padStart(2, "0")}-${String(estimatedArrival.day).padStart(2, "0")}`,
      arrivalTime: `${String(estimatedArrival.hour).padStart(2, "0")}:${String(estimatedArrival.minute).padStart(2, "0")}`,
      checkInTime,
      relationToCheckIn: difference > 0 ? "early" : difference < 0 ? "after_check_in" : "at_check_in",
      differenceMin: Math.abs(difference),
      timeZone,
    };
  } catch {
    return null;
  }
}
