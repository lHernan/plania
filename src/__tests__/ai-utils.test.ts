import { describe, expect, it } from "vitest";
import { extractJsonArray, extractJsonObject } from "@/lib/ai/json-response";
import { buildTripContext } from "@/lib/ai/trip-context";
import { normalizeAgentResponse } from "@/app/api/chat/route";

describe("AI response utilities", () => {
  it("extracts JSON objects from fenced model output", () => {
    expect(extractJsonObject<{ reply: string }>("```json\n{\"reply\":\"hello\"}\n```"))
      .toEqual({ reply: "hello" });
  });

  it("extracts JSON arrays surrounded by explanatory text", () => {
    expect(extractJsonArray<number>("Here you go: [1, 2, 3]"))
      .toEqual([1, 2, 3]);
  });

  it("returns null for malformed JSON", () => {
    expect(extractJsonObject("{not-json}")).toBeNull();
  });
});

describe("trip context", () => {
  it("keeps identifiers while removing fields that are not useful to the agent", () => {
    const context = buildTripContext({
      trip: { id: "trip-1", name: "Tokyo", ownerId: "user-1" },
      currentDate: "2026-09-04",
      currentTime: "10:30",
      days: [{
        id: "day-1",
        date: "2026-09-05",
        city: "Tokyo",
        label: "Day 1",
        activities: [{
          id: "activity-1",
          dayId: "day-1",
          tripId: "trip-1",
          userId: "user-1",
          city: "Tokyo",
          title: "Senso-ji",
          time: "09:00",
          durationMin: 90,
          category: "sightseeing",
          priority: "medium",
          state: "pending",
          sort_order: 0,
          notes: "Temple visit",
        }],
      }],
      reservations: [],
    });

    expect(context.days[0].id).toBe("day-1");
    expect(context.days[0].activities[0]).toMatchObject({ id: "activity-1", title: "Senso-ji" });
    expect(context.days[0].activities[0]).not.toHaveProperty("userId");
  });

  it("drops actions that target unknown itinerary records", () => {
    const context = {
      trip: { id: "trip-1", name: "Tokyo", ownerId: "user-1" },
      currentDate: "2026-09-04",
      currentTime: "10:30",
      days: [{
        id: "day-1",
        date: "2026-09-05",
        city: "Tokyo",
        label: "Day 1",
        activities: [],
      }],
      reservations: [],
    };

    const result = normalizeAgentResponse({
      reply: "I updated the plan.",
      actions: [
        { type: "add_activity", payload: { dayId: "unknown-day", title: "Unsafe change", time: "09:00" } },
        { type: "add_activity", payload: { dayId: "day-1", title: "Breakfast", time: "09:00" } },
      ],
    }, context, true);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("add_activity");
  });

  it("drops all itinerary actions when the assistant is read-only", () => {
    const context = {
      trip: { id: "trip-1", name: "Tokyo", ownerId: "user-1" },
      currentDate: "2026-09-04",
      currentTime: "10:30",
      days: [{
        id: "day-1",
        date: "2026-09-05",
        city: "Tokyo",
        label: "Day 1",
        activities: [],
      }],
      reservations: [],
    };
    const result = normalizeAgentResponse({
      reply: "I added breakfast.",
      actions: [{
        type: "add_activity",
        payload: { dayId: "day-1", title: "Breakfast", time: "09:00" },
      }],
    }, context, false);

    expect(result.actions).toEqual([]);
  });
});
