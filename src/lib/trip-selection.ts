import type { TripSummary } from "@/lib/types";

export type TripTiming = "active" | "upcoming" | "past";
export type TripSelectionReason = "favorite" | "active_trip" | "closest_upcoming" | "most_recent_past";

export type TripSelectionInputTrip = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_favorite: boolean;
  created_at: string;
};

export type TripSelectionInput = {
  current_date: string;
  trips: TripSelectionInputTrip[];
};

export type TripSelectionGroupTrip = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_favorite: boolean;
};

export type TripSelectionOutput = {
  selected_trip_id: string;
  selection_reason: TripSelectionReason;
  groups: {
    active: TripSelectionGroupTrip[];
    upcoming: TripSelectionGroupTrip[];
    past: TripSelectionGroupTrip[];
  };
  ui: {
    sections: [
      {
        type: "active";
        title: "Current Trip";
        visible: boolean;
      },
      {
        type: "upcoming";
        title: "Upcoming Trips";
        visible: boolean;
      },
      {
        type: "past";
        title: "Past Trips";
        visible: boolean;
        collapsed_by_default: true;
      },
    ];
    badges: {
      favorite: "⭐";
      active: "●";
      past: "✓";
    };
    hints: {
      default_selection_label: string;
      empty_state: string | null;
    };
  };
};

type ClassifiedTrip = TripSelectionInputTrip & {
  timing: TripTiming;
};

function dateToUtcMs(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

function compareAsc(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareDesc(left: string, right: string) {
  return compareAsc(right, left);
}

function compareCreatedAtAsc(left: ClassifiedTrip, right: ClassifiedTrip) {
  const created = compareAsc(left.created_at, right.created_at);
  if (created !== 0) return created;
  return compareAsc(left.id, right.id);
}

function compareCreatedAtDesc(left: ClassifiedTrip, right: ClassifiedTrip) {
  const created = compareDesc(left.created_at, right.created_at);
  if (created !== 0) return created;
  return compareAsc(left.id, right.id);
}

function classifyTrip(currentDate: string, trip: TripSelectionInputTrip): ClassifiedTrip {
  let timing: TripTiming = "active";

  if (trip.start_date > currentDate) timing = "upcoming";
  else if (trip.end_date < currentDate) timing = "past";

  return { ...trip, timing };
}

function sortUpcoming(left: ClassifiedTrip, right: ClassifiedTrip) {
  const startDate = compareAsc(left.start_date, right.start_date);
  if (startDate !== 0) return startDate;
  return compareCreatedAtAsc(left, right);
}

function sortActive(left: ClassifiedTrip, right: ClassifiedTrip) {
  const startDate = compareDesc(left.start_date, right.start_date);
  if (startDate !== 0) return startDate;
  const endDate = compareAsc(left.end_date, right.end_date);
  if (endDate !== 0) return endDate;
  return compareCreatedAtDesc(left, right);
}

function sortPast(left: ClassifiedTrip, right: ClassifiedTrip) {
  const endDate = compareDesc(left.end_date, right.end_date);
  if (endDate !== 0) return endDate;
  return compareCreatedAtDesc(left, right);
}

function toGroupTrip(trip: ClassifiedTrip): TripSelectionGroupTrip {
  return {
    id: trip.id,
    name: trip.name,
    start_date: trip.start_date,
    end_date: trip.end_date,
    is_favorite: trip.is_favorite,
  };
}

function buildSelectionLabel(reason: TripSelectionReason) {
  switch (reason) {
    case "favorite":
      return "Favorite trip selected";
    case "active_trip":
      return "Active trip selected";
    case "closest_upcoming":
      return "Closest upcoming trip selected";
    case "most_recent_past":
      return "Most recent past trip selected";
  }
}

function selectDefaultTrip(classifiedTrips: ClassifiedTrip[]) {
  const favorites = classifiedTrips.filter((trip) => trip.is_favorite);

  if (favorites.length > 0) {
    const activeFavorites = favorites.filter((trip) => trip.timing === "active").sort(sortActive);
    if (activeFavorites.length > 0) {
      return {
        selectedTrip: activeFavorites[0],
        selectionReason: "favorite" as const,
      };
    }

    const upcomingFavorites = favorites.filter((trip) => trip.timing === "upcoming").sort(sortUpcoming);
    if (upcomingFavorites.length > 0) {
      return {
        selectedTrip: upcomingFavorites[0],
        selectionReason: "favorite" as const,
      };
    }

    const pastFavorites = favorites.filter((trip) => trip.timing === "past").sort(sortPast);
    if (pastFavorites.length > 0) {
      return {
        selectedTrip: pastFavorites[0],
        selectionReason: "favorite" as const,
      };
    }
  }

  const activeTrips = classifiedTrips.filter((trip) => trip.timing === "active").sort(sortActive);
  if (activeTrips.length > 0) {
    return {
      selectedTrip: activeTrips[0],
      selectionReason: "active_trip" as const,
    };
  }

  const upcomingTrips = classifiedTrips.filter((trip) => trip.timing === "upcoming").sort((left, right) => {
    const distance = dateToUtcMs(left.start_date) - dateToUtcMs(right.start_date);
    if (distance !== 0) return distance;
    return sortUpcoming(left, right);
  });
  if (upcomingTrips.length > 0) {
    return {
      selectedTrip: upcomingTrips[0],
      selectionReason: "closest_upcoming" as const,
    };
  }

  const pastTrips = classifiedTrips.filter((trip) => trip.timing === "past").sort(sortPast);
  if (pastTrips.length > 0) {
    return {
      selectedTrip: pastTrips[0],
      selectionReason: "most_recent_past" as const,
    };
  }

  return {
    selectedTrip: null,
    selectionReason: "closest_upcoming" as const,
  };
}

export function resolveTripSelection(input: TripSelectionInput): TripSelectionOutput {
  const classifiedTrips = input.trips.map((trip) => classifyTrip(input.current_date, trip));
  const activeTrips = classifiedTrips.filter((trip) => trip.timing === "active").sort(sortActive);
  const upcomingTrips = classifiedTrips.filter((trip) => trip.timing === "upcoming").sort(sortUpcoming);
  const pastTrips = classifiedTrips.filter((trip) => trip.timing === "past").sort(sortPast);
  const { selectedTrip, selectionReason } = selectDefaultTrip(classifiedTrips);

  return {
    selected_trip_id: selectedTrip?.id ?? "",
    selection_reason: selectionReason,
    groups: {
      active: activeTrips.map(toGroupTrip),
      upcoming: upcomingTrips.map(toGroupTrip),
      past: pastTrips.map(toGroupTrip),
    },
    ui: {
      sections: [
        {
          type: "active",
          title: "Current Trip",
          visible: activeTrips.length > 0,
        },
        {
          type: "upcoming",
          title: "Upcoming Trips",
          visible: upcomingTrips.length > 0,
        },
        {
          type: "past",
          title: "Past Trips",
          visible: pastTrips.length > 0,
          collapsed_by_default: true,
        },
      ],
      badges: {
        favorite: "⭐",
        active: "●",
        past: "✓",
      },
      hints: {
        default_selection_label: selectedTrip ? buildSelectionLabel(selectionReason) : "",
        empty_state: classifiedTrips.length === 0 ? "No trips yet" : null,
      },
    },
  };
}

export function getCurrentDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveTripSelectionFromSummaries(currentDate: string, trips: TripSummary[]) {
  return resolveTripSelection({
    current_date: currentDate,
    trips: trips
      .filter((trip) => Boolean(trip.startDate && trip.endDate))
      .map((trip) => ({
        id: trip.id,
        name: trip.name,
        start_date: trip.startDate as string,
        end_date: trip.endDate as string,
        is_favorite: Boolean(trip.isFavorite),
        created_at: trip.createdAt ?? "",
      })),
  });
}
