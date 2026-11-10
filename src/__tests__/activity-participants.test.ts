import { describe, expect, it } from "vitest";
import { activitiesForPerson, isSharedActivity, loadActivityParticipants, withParticipants } from "@/lib/activity-participants";
import type { TripDay } from "@/lib/types";

// The five-person trip of the spec: two flights to Madrid for different people, plus shared plans.
const shared = { id: "walk", participantIds: [] as string[] };
const flightTenerife = { id: "tfn", participantIds: ["hernan", "jackeline"] };
const flightColombia = { id: "bog", participantIds: ["maria", "p4", "p5"] };
const carPickup = { id: "car", participantIds: ["maria"] };
const legacy = { id: "old" } as { id: string; participantIds?: string[] };
const all = [shared, flightTenerife, flightColombia, carPickup, legacy];

describe("activitiesForPerson", () => {
  it("everyone (null) sees every activity of the trip", () => {
    expect(activitiesForPerson(all, null)).toEqual(all);
  });

  it("a person sees the shared activities and the ones assigned to them, never other people's", () => {
    expect(activitiesForPerson(all, "jackeline").map((a) => a.id)).toEqual(["walk", "tfn", "old"]);
    expect(activitiesForPerson(all, "maria").map((a) => a.id)).toEqual(["walk", "bog", "car", "old"]);
    expect(activitiesForPerson(all, "p4").map((a) => a.id)).toEqual(["walk", "bog", "old"]);
  });
});

describe("isSharedActivity", () => {
  it("an activity without assignments is always shared", () => {
    expect(isSharedActivity(shared)).toBe(true);
    expect(isSharedActivity(legacy)).toBe(true);
    expect(isSharedActivity(carPickup)).toBe(false);
  });
});

describe("withParticipants", () => {
  const day = (activities: { id: string; participantIds?: string[] }[]) => [{ id: "d1", activities }] as unknown as TripDay[];

  it("puts the loaded assignment on each activity and empties the rest", () => {
    const result = withParticipants(day([{ id: "tfn" }, { id: "walk", participantIds: ["stale"] }]), new Map([["tfn", ["hernan"]]]));
    expect(result[0].activities.map((a) => a.participantIds)).toEqual([["hernan"], []]);
  });

  it("keeps the cached assignment when the read failed", () => {
    const cached = day([{ id: "tfn", participantIds: ["hernan"] }]);
    const result = withParticipants(day([{ id: "tfn" }, { id: "walk" }]), null, cached);
    expect(result[0].activities.map((a) => a.participantIds)).toEqual([["hernan"], []]);
  });
});

describe("loadActivityParticipants", () => {
  const client = (result: { data: unknown; error: { message?: string } | null }) => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve(result) }) }),
  });

  it("groups the rows by activity", async () => {
    const map = await loadActivityParticipants(
      client({ data: [{ activity_id: "a", user_id: "u1" }, { activity_id: "a", user_id: "u2" }, { activity_id: "b", user_id: "u1" }], error: null }) as never,
      "trip"
    );
    expect(map && Object.fromEntries(map)).toEqual({ a: ["u1", "u2"], b: ["u1"] });
  });

  it("answers null on error so callers keep what they had", async () => {
    expect(await loadActivityParticipants(client({ data: null, error: { message: "missing" } }) as never, "trip")).toBeNull();
  });
});
