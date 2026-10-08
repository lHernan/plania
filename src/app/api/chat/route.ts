import { NextResponse } from "next/server";
import { extractJsonObject } from "@/lib/ai/json-response";
import { runAiPrompt } from "@/lib/ai/provider";
import { buildTripContext, type TripContext } from "@/lib/ai/trip-context";
import { getCurrentTripDateTime, parseTravelContext } from "@/lib/travel-context";
import { getAuthClient, getServiceRoleSupabase } from "@/lib/supabase-server";
import type {
  ActivityCategory,
  ActivityState,
  ChatAction,
  ChatActivityPatch,
  ChatMessage,
  ChatReservationPayload,
  CriticalReservation,
  Priority,
} from "@/lib/types";

const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  "sightseeing",
  "reservation",
  "transport",
  "hotel",
  "food",
  "shopping",
  "photos",
  "nightlife",
  "other",
];
const ACTIVITY_STATES: ActivityState[] = ["pending", "completed", "skipped", "delayed"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
const RESERVATION_URGENCIES = ["safe", "this_week", "today"] as const;
const RESERVATION_STATUSES = ["pending", "booked"] as const;

type DayRow = {
  id: string;
  date: string;
  city: string;
  label: string;
};

type ActivityRow = {
  id: string;
  day_id: string;
  city?: string | null;
  title: string;
  time: string;
  duration_min: number;
  notes?: string | null;
  location?: string | null;
  maps_url?: string | null;
  reservation_url?: string | null;
  expected_cost?: number | null;
  category: ActivityCategory;
  priority: Priority;
  state: ActivityState;
  sort_order: number;
};

type ReservationRow = {
  id: string;
  user_id: string;
  title: string;
  booking_deadline: string;
  reservation_date: string;
  booking_link?: string | null;
  urgency: CriticalReservation["urgency"];
  status: CriticalReservation["status"];
  price?: number | null;
};

type MessageRow = {
  id: string;
  trip_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[] | null;
  created_at: string;
};

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    actions: row.actions ?? undefined,
    createdAt: row.created_at,
  };
}

function responseFromThrown(error: Response) {
  return NextResponse.json(
    { error: error.statusText || "Request rejected" },
    { status: error.status || 500 },
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, fallback = "", maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function cleanActivityPatch(value: unknown): ChatActivityPatch {
  const source = getRecord(value);
  if (!source) return {};

  const patch: ChatActivityPatch = {};
  if (isString(source.title)) patch.title = cleanText(source.title, "", 160);
  if (isTime(source.time)) patch.time = source.time;
  if (typeof source.durationMin === "number") patch.durationMin = boundedNumber(source.durationMin, 60, 5, 1_440);
  if (typeof source.notes === "string") patch.notes = cleanText(source.notes);
  if (typeof source.location === "string") patch.location = cleanText(source.location, "", 240);
  if (typeof source.mapsUrl === "string") patch.mapsUrl = cleanText(source.mapsUrl, "", 500);
  if (typeof source.reservationUrl === "string") patch.reservationUrl = cleanText(source.reservationUrl, "", 500);
  if (typeof source.expectedCost === "number" && Number.isFinite(source.expectedCost)) {
    patch.expectedCost = Math.max(0, source.expectedCost);
  }
  if (ACTIVITY_CATEGORIES.includes(source.category as ActivityCategory)) patch.category = source.category as ActivityCategory;
  if (PRIORITIES.includes(source.priority as Priority)) patch.priority = source.priority as Priority;
  if (ACTIVITY_STATES.includes(source.state as ActivityState)) patch.state = source.state as ActivityState;
  return patch;
}

function findActivity(context: TripContext, activityId: string) {
  for (const day of context.days) {
    const activity = day.activities.find((item) => item.id === activityId);
    if (activity) return { day, activity };
  }
  return null;
}

function normalizeAction(value: unknown, context: TripContext): ChatAction | null {
  const record = getRecord(value);
  if (!record || !isString(record.type)) return null;
  const payload = getRecord(record.payload);

  if (record.type === "add_activity" && payload && isString(payload.dayId) && isString(payload.title)) {
    const day = context.days.find((item) => item.id === payload.dayId);
    if (!day || !isTime(payload.time)) return null;
    const category = ACTIVITY_CATEGORIES.includes(payload.category as ActivityCategory)
      ? payload.category as ActivityCategory
      : "other";
    const priority = PRIORITIES.includes(payload.priority as Priority)
      ? payload.priority as Priority
      : "medium";
    const state = ACTIVITY_STATES.includes(payload.state as ActivityState)
      ? payload.state as ActivityState
      : "pending";

    return {
      type: "add_activity",
      payload: {
        dayId: day.id,
        city: day.city,
        title: cleanText(payload.title, "New activity", 160),
        time: payload.time,
        durationMin: boundedNumber(payload.durationMin, 60, 5, 1_440),
        notes: cleanText(payload.notes, "", 500),
        location: cleanText(payload.location, "", 240),
        mapsUrl: cleanText(payload.mapsUrl, "", 500),
        reservationUrl: cleanText(payload.reservationUrl, "", 500),
        expectedCost: typeof payload.expectedCost === "number" ? Math.max(0, payload.expectedCost) : undefined,
        category,
        priority,
        state,
      },
    };
  }

  if (
    record.type === "patch_activity" &&
    payload &&
    isString(payload.dayId) &&
    isString(payload.activityId) &&
    context.days.some((day) => day.id === payload.dayId) &&
    findActivity(context, payload.activityId)?.day.id === payload.dayId
  ) {
    const patch = cleanActivityPatch(payload.patch);
    return Object.keys(patch).length > 0
      ? { type: "patch_activity", payload: { dayId: payload.dayId, activityId: payload.activityId, patch } }
      : null;
  }

  if (
    record.type === "update_activity_state" &&
    payload &&
    isString(payload.dayId) &&
    isString(payload.activityId) &&
    ACTIVITY_STATES.includes(payload.state as ActivityState) &&
    findActivity(context, payload.activityId)?.day.id === payload.dayId
  ) {
    return {
      type: "update_activity_state",
      payload: {
        dayId: payload.dayId,
        activityId: payload.activityId,
        state: payload.state as ActivityState,
      },
    };
  }

  if (record.type === "reorder_activities" && payload && isString(payload.dayId) && Array.isArray(payload.orderedActivityIds)) {
    const day = context.days.find((item) => item.id === payload.dayId);
    const ids = payload.orderedActivityIds.filter(isString);
    const currentIds = day?.activities.map((activity) => activity.id) ?? [];
    if (day && ids.length === currentIds.length && new Set(ids).size === currentIds.length && ids.every((id) => currentIds.includes(id))) {
      return { type: "reorder_activities", payload: { dayId: day.id, orderedActivityIds: ids } };
    }
  }

  if (record.type === "add_reservation" && payload && isString(payload.title)) {
    const urgency = RESERVATION_URGENCIES.includes(payload.urgency as typeof RESERVATION_URGENCIES[number])
      ? payload.urgency as CriticalReservation["urgency"]
      : "safe";
    const status = RESERVATION_STATUSES.includes(payload.status as typeof RESERVATION_STATUSES[number])
      ? payload.status as CriticalReservation["status"]
      : "pending";
    if (!isString(payload.bookingDeadline) || !isString(payload.reservationDate)) return null;
    const reservation: ChatReservationPayload = {
      title: cleanText(payload.title, "Reservation", 160),
      bookingDeadline: cleanText(payload.bookingDeadline, "", 30),
      reservationDate: cleanText(payload.reservationDate, "", 30),
      bookingLink: cleanText(payload.bookingLink, "", 500),
      urgency,
      status,
      price: typeof payload.price === "number" ? Math.max(0, payload.price) : undefined,
    };
    return { type: "add_reservation", payload: reservation };
  }

  return null;
}

export function normalizeAgentResponse(value: unknown, context: TripContext, canWrite: boolean) {
  const record = getRecord(value);
  const reply = cleanText(record?.reply, "I couldn't understand that request.", 2_000);
  const actions = canWrite && Array.isArray(record?.actions)
    ? record.actions.map((action) => normalizeAction(action, context)).filter((action): action is ChatAction => Boolean(action)).slice(0, 8)
    : [];
  return { reply, actions };
}

async function authorizeTrip(request: Request, tripId: string) {
  const supabase = getAuthClient(request);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const caller = authData.user;
  if (authError || !caller) throw new Response("No autenticado", { status: 401 });

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, name, user_id, start_date, end_date, travel_context")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError || !trip) throw new Response("Viaje no encontrado", { status: 404 });

  if (trip.user_id !== caller.id) {
    const { data: share } = await supabase
      .from("trip_shares")
      .select("trip_id")
      .eq("trip_id", tripId)
      .eq("shared_with", caller.id)
      .maybeSingle();
    if (!share) throw new Response("No tienes acceso a este viaje", { status: 403 });
  }

  return { supabase, caller, trip };
}

async function loadTripContext(access: Awaited<ReturnType<typeof authorizeTrip>>) {
  const { supabase, caller, trip } = access;
  const [{ data: days, error: daysError }, { data: activities, error: activitiesError }, { data: reservations, error: reservationsError }] = await Promise.all([
    supabase.from("trip_days").select("id, date, city, label").eq("trip_id", trip.id).order("date", { ascending: true }),
    supabase.from("activities").select("*").eq("trip_id", trip.id).order("sort_order", { ascending: true }),
    supabase.from("critical_reservations").select("*").eq("trip_id", trip.id),
  ]);
  if (daysError || activitiesError || reservationsError) {
    throw new Response("No se pudo cargar el contexto del viaje", { status: 500 });
  }

  const dayRows = (days ?? []) as DayRow[];
  const activityRows = (activities ?? []) as ActivityRow[];
  const reservationRows = (reservations ?? []) as ReservationRow[];
  const travelContext = parseTravelContext(trip.travel_context);
  const canShareTravelContext = travelContext?.shareWithAI === true;
  const current = getCurrentTripDateTime(
    new Date(),
    canShareTravelContext ? travelContext.arrival?.timeZone : undefined,
  );
  const context: TripContext = {
    trip: {
      id: trip.id,
      name: trip.name,
      startDate: trip.start_date,
      endDate: trip.end_date,
      ownerId: trip.user_id,
      travelContext,
    },
    days: dayRows.map((day) => ({
      ...day,
      activities: activityRows
        .filter((activity) => activity.day_id === day.id)
        .map((activity) => ({
          id: activity.id,
          dayId: day.id,
          tripId: trip.id,
          userId: caller.id,
          city: activity.city ?? day.city,
          title: activity.title,
          time: activity.time,
          durationMin: activity.duration_min,
          notes: activity.notes ?? undefined,
          location: activity.location ?? undefined,
          mapsUrl: activity.maps_url ?? undefined,
          reservationUrl: activity.reservation_url ?? undefined,
          expectedCost: activity.expected_cost ?? undefined,
          category: activity.category,
          priority: activity.priority,
          state: activity.state,
          sort_order: activity.sort_order,
        })),
    })),
    reservations: reservationRows.map((reservation) => ({
      id: reservation.id,
      title: reservation.title,
      userId: caller.id,
      bookingDeadline: reservation.booking_deadline,
      reservationDate: reservation.reservation_date,
      bookingLink: reservation.booking_link ?? undefined,
      urgency: reservation.urgency,
      status: reservation.status,
      price: reservation.price ?? undefined,
    })),
    currentDate: current.date,
    currentTime: current.time,
    currentTimeZone: current.timeZone,
    currentTimeZoneSource: current.timeZoneSource,
  };

  return context;
}

function systemPrompt(context: TripContext) {
  return `You are Plania, a practical travel planning agent. Help the traveler plan and track the trip using the supplied context.

Current trip context:
${JSON.stringify(buildTripContext(context))}

Rules:
- Give concise, useful answers grounded in this trip. Do not invent bookings, opening hours, prices, or live facts.
- If information is missing, say so and make a clearly labeled suggestion.
- This assistant is currently read-only. Never return actions that modify the itinerary or reservations.
- Return ONLY valid JSON with this exact shape: {"reply":"string","actions":[]}
`;
}

async function getMessages(supabase: ReturnType<typeof getAuthClient>, tripId: string) {
  const { data, error } = await supabase
    .from("trip_messages")
    .select("id, trip_id, user_id, role, content, actions, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map(toChatMessage).reverse();
}

export async function GET(request: Request) {
  try {
    const tripId = new URL(request.url).searchParams.get("tripId");
    if (!tripId) return NextResponse.json({ error: "tripId is required" }, { status: 400 });
    const { supabase } = await authorizeTrip(request, tripId);
    return NextResponse.json({ messages: await getMessages(supabase, tripId) });
  } catch (error) {
    if (error instanceof Response) return responseFromThrown(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Chat history failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { tripId?: unknown; content?: unknown };
    const tripId = typeof body.tripId === "string" ? body.tripId : "";
    const content = typeof body.content === "string" ? body.content.trim().slice(0, 2_000) : "";
    if (!tripId || !content) return NextResponse.json({ error: "tripId and content are required" }, { status: 400 });

    const access = await authorizeTrip(request, tripId);
    const { supabase, caller } = access;
    const admin = getServiceRoleSupabase();
    const { data: allowed, error: rateLimitError } = await admin.rpc("consume_trip_chat_request", {
      p_user_id: caller.id,
      p_trip_id: tripId,
    });
    if (rateLimitError) {
      return NextResponse.json({ error: "Travel chat is temporarily unavailable." }, { status: 503 });
    }
    if (allowed !== true) {
      return NextResponse.json({ error: "Please wait before sending another travel chat message." }, { status: 429 });
    }

    const context = await loadTripContext(access);
    const { error: userMessageError } = await admin.from("trip_messages").insert({
      trip_id: tripId,
      user_id: caller.id,
      role: "user",
      content,
      actions: null,
    });
    if (userMessageError) throw userMessageError;

    const history = await getMessages(supabase, tripId);
    const historyPrompt = history
      .slice(0, -1)
      .slice(-20)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");
    const raw = await runAiPrompt(systemPrompt(context), `${historyPrompt}\nuser: ${content}`);
    const parsed = extractJsonObject<{ reply?: unknown; actions?: unknown[] }>(raw);
    const result = normalizeAgentResponse(parsed, context, false);

    // Chat rows are server-authored; user sessions can only read the shared history.
    const { data: assistantMessage, error: assistantMessageError } = await admin
      .from("trip_messages")
      .insert({
        trip_id: tripId,
        user_id: caller.id,
        role: "assistant",
        content: result.reply,
        actions: [],
      })
      .select("id, trip_id, user_id, role, content, actions, created_at")
      .single();
    if (assistantMessageError || !assistantMessage) throw assistantMessageError ?? new Error("Assistant message was not saved");

    return NextResponse.json({ message: toChatMessage(assistantMessage as MessageRow), actions: result.actions });
  } catch (error) {
    if (error instanceof Response) return responseFromThrown(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Chat request failed" }, { status: 500 });
  }
}
