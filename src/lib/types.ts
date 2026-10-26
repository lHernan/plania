export type ActivityCategory =
  | "sightseeing"
  | "reservation"
  | "transport"
  | "hotel"
  | "food"
  | "shopping"
  | "photos"
  | "nightlife"
  | "other";

export type ActivityState = "pending" | "completed" | "skipped" | "delayed";
export type Priority = "low" | "medium" | "high" | "critical";
export type ReservationStatus = "pending" | "booked";
export type ShoppingItemStatus = "pending" | "purchased" | "hidden";
export type ShoppingCategory =
  | "souvenir"
  | "fashion"
  | "beauty"
  | "food"
  | "home"
  | "electronics"
  | "other";

export type FocusArea = {
  x: number; // 0 to 1
  y: number; // 0 to 1
  width: number; // 0 to 1
  height: number; // 0 to 1
};

export type ActivityFile = {
  id: string;
  activityId: string;
  tripId: string;
  userId: string;
  fileUrl: string;
  filePath: string;
  fileType: "pdf" | "image" | "other";
  fileName: string;
  createdAt: string;
  focusArea?: FocusArea;
};

export type Activity = {
  id: string;
  dayId: string;
  tripId: string;
  userId: string;
  city: string;
  title: string;
  time: string;
  durationMin: number;
  notes?: string;
  location?: string;
  mapsUrl?: string;
  reservationUrl?: string;
  transportNotes?: string;
  expectedCost?: number;
  category: ActivityCategory;
  priority: Priority;
  state: ActivityState;
  sort_order: number;
  files?: ActivityFile[];
  timeConfidence?: number;
  timeInferred?: boolean;
  /** manual (default), booking = confirmed commitment from a document, suggested = accepted AI proposal. */
  origin?: ActivityOrigin;
  /** Structured details when origin is "booking". */
  booking?: BookingDetails;
};

export type ActivityOrigin = "manual" | "booking" | "suggested";

export type BookingType =
  | "flight"
  | "lodging"
  | "car_rental"
  | "train"
  | "ferry"
  | "bus"
  | "transfer"
  | "ticket"
  | "other";

/** Which moment of a booking an activity represents (a stay has check-in and check-out). */
export type BookingRole = "single" | "departure" | "check_in" | "check_out" | "pickup" | "dropoff";

/** extracted = read from the document, estimated = derived by Tachao, needs_confirmation = missing or ambiguous. */
export type BookingFieldStatus = "extracted" | "estimated" | "needs_confirmation";

/** Local wall-clock moment; timeZone is an IANA zone when known (e.g. "Atlantic/Canary"). */
export type BookingMoment = { date?: string; time?: string; timeZone?: string };

export type BookingDetails = {
  version: 1;
  type: BookingType;
  role: BookingRole;
  /** Shared by the activities created from one booking (e.g. pickup + dropoff). */
  groupId: string;
  title: string;
  provider?: string;
  reference?: string;
  start?: BookingMoment;
  end?: BookingMoment;
  from?: string;
  to?: string;
  address?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  details?: string;
  fieldStatus: Partial<Record<BookingField, BookingFieldStatus>>;
  source?: { fileName: string; sha256: string };
};

export type BookingField =
  | "title"
  | "provider"
  | "reference"
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime"
  | "timeZone"
  | "from"
  | "to"
  | "address"
  | "pickupLocation"
  | "dropoffLocation";

export type BookingUrgency = "safe" | "this_week" | "today";

export type CriticalReservation = {
  id: string;
  title: string;
  bookingDeadline: string;
  reservationDate: string;
  bookingLink?: string;
  urgency: BookingUrgency;
  status: ReservationStatus;
  price?: number;
  cancellationNotes?: string;
  userId: string;
};

export type TripDay = {
  id: string;
  date: string;
  city: string;
  label: string;
  activities: Activity[];
  userId: string;
};

export type TripPlan = {
  id: string;
  name: string;
  userId?: string | null;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  isFavorite?: boolean;
  travelContext?: TravelContext;
  days: TripDay[];
  criticalReservations: CriticalReservation[];
  shoppingItems: ShoppingItem[];
  ignoredShoppingSuggestionKeys: string[];
};

export type ArrivalTransportMode = "public_transport" | "taxi" | "ride_hailing" | "private_transfer" | "other";
export type ArrivalPriceBasis = "per_person" | "whole_group" | "per_vehicle";

export type ArrivalOption = {
  id: string;
  name: string;
  mode: ArrivalTransportMode;
  amount: number;
  priceBasis: ArrivalPriceBasis;
  vehicleCapacity?: number;
  luggageCapacity?: number;
  currency: string;
  durationMin: number;
  transfers?: number;
  walkingMin?: number;
  comfortScore?: number;
  source: string;
  sourceCheckedAt: string;
  isEstimate: boolean;
  notes?: string;
};

export type TravelContext = {
  version: 1;
  shareWithAI?: boolean;
  travelerCount?: number;
  luggage?: {
    carryOnBags?: number;
    checkedBags?: number;
  };
  arrival?: {
    location?: string;
    localDate?: string;
    localTime?: string;
    timeZone?: string;
  };
  hotel?: {
    name?: string;
    address?: string;
    checkIn?: string;
    checkOut?: string;
  };
  preferences?: {
    minimizeWalking?: boolean;
    avoidTransfers?: boolean;
    budgetLevel?: "low" | "medium" | "high";
  };
  arrivalOptions?: ArrivalOption[];
};

export type TripSummary = {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  isFavorite?: boolean;
  dayCount: number;
  activityCount: number;
};

export type OptimizationSuggestion = {
  id: string;
  title: string;
  reason: string;
  impact: "time" | "cost" | "comfort";
};

export type ShoppingItem = {
  id: string;
  name: string;
  category: ShoppingCategory;
  notes: string | null;
  preferred_cities: string[] | null;
  preferred_country: string | null;
  priority: "low" | "medium" | "high";
  status: ShoppingItemStatus;
};

export type ShoppingCandidatePlace = {
  name: string;
  area: string | null;
};

export type ShoppingSuggestion = {
  shopping_item_id: string;
  title: string;
  reason: string;
  suggested_time: string | null;
  suggested_duration: number | null;
  location_suggestions: ShoppingCandidatePlace[];
  confidence: number;
  ui_hints?: {
    can_add_to_plan: boolean;
    can_ignore: boolean;
    ignore_key?: string;
  };
};

export type ShoppingAssistantUi = {
  input_mode: "textbox";
  input_placeholder: string;
  list_style: "todo";
  show_suggestions_card: boolean;
};

export type ShoppingAssistantResponse = {
  ui: ShoppingAssistantUi;
  wishlist_items: ShoppingItem[];
  suggestions: ShoppingSuggestion[];
};

export type ShoppingAssistantWishlistInput = {
  type: "wishlist_input";
  text: string;
  shopping_list?: ShoppingItem[];
};

export type ShoppingAssistantSuggestionInput = {
  type: "suggestions";
  day: {
    date: string;
    city: string;
    country: string;
  };
  itinerary: Activity[];
  shopping_list: ShoppingItem[];
  candidate_places?: ShoppingCandidatePlace[];
  ignored_suggestion_keys?: string[];
};

export type ShoppingAssistantRequest =
  | ShoppingAssistantWishlistInput
  | ShoppingAssistantSuggestionInput;

// ─── Viajes Compartidos ──────────────────────────────────────────────────────

/** Un usuario que tiene acceso compartido a un viaje */
export type TripShareRole = "viewer" | "editor";

export type ActivityComment = {
  id: string;
  activityId: string;
  tripId: string;
  userId: string;
  userEmail?: string;
  content: string;
  createdAt: string;
};

export type TripShareLink = {
  id: string;
  tripId: string;
  token: string;
  role: TripShareRole;
  email: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

export type TripShareUser = {
  userId: string;
  email: string;
  role: TripShareRole;
  createdAt: string;
};

/** Resumen de viaje compartido con el usuario autenticado (incluye info del propietario) */
export type SharedTripSummary = TripSummary & {
  ownerEmail: string;
  ownerId: string;
};

export type ChatRole = "user" | "assistant";

export type ChatActivityPayload = {
  dayId: string;
  city: string;
  title: string;
  time: string;
  durationMin: number;
  notes?: string;
  location?: string;
  mapsUrl?: string;
  reservationUrl?: string;
  expectedCost?: number;
  category: ActivityCategory;
  priority: Priority;
  state: ActivityState;
};

export type ChatActivityPatch = Partial<Pick<
  Activity,
  | "title"
  | "time"
  | "durationMin"
  | "notes"
  | "location"
  | "mapsUrl"
  | "reservationUrl"
  | "expectedCost"
  | "category"
  | "priority"
  | "state"
>>;

export type ChatReservationPayload = Omit<CriticalReservation, "id" | "userId">;

export type ChatAction =
  | { type: "add_activity"; payload: ChatActivityPayload }
  | { type: "patch_activity"; payload: { dayId: string; activityId: string; patch: ChatActivityPatch } }
  | { type: "update_activity_state"; payload: { dayId: string; activityId: string; state: ActivityState } }
  | { type: "reorder_activities"; payload: { dayId: string; orderedActivityIds: string[] } }
  | { type: "add_reservation"; payload: ChatReservationPayload };

export type ChatMessage = {
  id: string;
  tripId: string;
  userId: string;
  role: ChatRole;
  content: string;
  actions?: ChatAction[];
  createdAt: string;
};

// ─── Packing List ────────────────────────────────────────────────────────────

export type PackingItemStatus = "pending" | "packed";

export type PackingItem = {
  id: string;
  name: string;
  quantity: number;
  reason: string;
  status: PackingItemStatus;
};

export type PackingCategory = {
  name: string;
  items: PackingItem[];
};

export type WeatherSummary = {
  city: string;
  tempMinC: number;
  tempMaxC: number;
  rainProbabilityMax: number;
};

export type PackingList = {
  tripId: string;
  generatedAt: string;
  weatherSummaries: WeatherSummary[];
  categories: PackingCategory[];
};
