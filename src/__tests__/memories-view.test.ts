import { describe, expect, it } from "vitest";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";
import {
  MEMORY_ERROR_KEYS,
  memoriesForActivity,
  memoryPerson,
  memoryStoryDays,
  memoryViewers,
  tripLevelMemories,
} from "@/lib/memories-view";
import type { Memory } from "@/lib/types";

const memory = (id: string, overrides: Partial<Memory> = {}): Memory => ({
  id,
  tripId: "t",
  activityId: null,
  authorId: "me",
  note: `Note ${id}`,
  rating: null,
  audience: "trip",
  audienceUserIds: [],
  photos: [],
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...overrides,
});

describe("memories view helpers", () => {
  it("splits memories by activity and keeps trip-level ones apart", () => {
    const list = [memory("m1", { activityId: "a1" }), memory("m2"), memory("m3", { activityId: "a1" }), memory("m4", { activityId: "a2" })];
    expect(memoriesForActivity(list, "a1").map((m) => m.id)).toEqual(["m1", "m3"]);
    expect(tripLevelMemories(list).map((m) => m.id)).toEqual(["m2"]);
  });

  it("tells the story by day: only days with completed activities or memories, completed or remembered activities by time", () => {
    const d1 = makeDay("d1", [
      makeActivity("a2", { time: "12:00", state: "completed" }),
      makeActivity("a1", { time: "09:00", state: "completed" }),
      makeActivity("a3", { time: "15:00" }),
    ]);
    const d2 = { ...makeDay("d2", [makeActivity("b1")]), date: "2026-10-27" };
    const d3 = { ...makeDay("d3", [makeActivity("c1"), makeActivity("c2")]), date: "2026-10-28" };
    const trip = makeTrip([d1, d2, d3]);
    const story = memoryStoryDays(trip, [memory("m1", { activityId: "c2" })]);
    expect(story.map((entry) => [entry.day.id, entry.dayNumber, entry.activities.map((a) => a.id)])).toEqual([
      ["d1", 1, ["a1", "a2"]],
      ["d3", 3, ["c2"]],
    ]);
  });

  it("names a person as you, by email, or as someone unknown", () => {
    const members = [{ userId: "u2", email: "ana@x.io", isOwner: true }];
    expect(memoryPerson("me", "me", members)).toEqual({ kind: "you" });
    expect(memoryPerson("u2", "me", members)).toEqual({ kind: "email", email: "ana@x.io" });
    expect(memoryPerson("u9", "me", members)).toEqual({ kind: "unknown" });
  });

  it("lists who sees a selected memory: the author first, then its audience", () => {
    expect(memoryViewers(memory("m", { audience: "selected", authorId: "u2", audienceUserIds: ["me", "u2", "u3"] }))).toEqual(["u2", "me", "u3"]);
  });

  it("maps every memory error to a message key", () => {
    expect(Object.keys(MEMORY_ERROR_KEYS).sort()).toEqual(["draft", "failed", "forbidden", "invalid", "offline", "unavailable"]);
  });
});
