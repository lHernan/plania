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
};

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
  days: TripDay[];
  criticalReservations: CriticalReservation[];
  shoppingItems: ShoppingItem[];
  ignoredShoppingSuggestionKeys: string[];
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
