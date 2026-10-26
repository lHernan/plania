// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";
import type { TripPlan } from "@/lib/types";

// Remote write outcome per activity id; anything not listed succeeds.
const remote = vi.hoisted(() => ({
  errors: {} as Record<string, string>,
  updates: [] as { id: string; state: string }[],
  delayMs: 0,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (patch: { state: string }) => ({
        eq: async (_column: string, id: string) => {
          remote.updates.push({ id, state: patch.state });
          if (remote.delayMs) await new Promise((r) => setTimeout(r, remote.delayMs));
          return { error: remote.errors[id] ? { message: remote.errors[id] } : null };
        },
      }),
    }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useCelebration } = await import("@/hooks/use-celebration");

function loadTrip(trip: TripPlan) {
  useItineraryStore.setState({ activeTrip: trip, trips: [], error: null });
}

const stateOf = (activityId: string) =>
  useItineraryStore
    .getState()
    .activeTrip?.days.flatMap((d) => d.activities)
    .find((a) => a.id === activityId)?.state;

beforeEach(() => {
  remote.errors = {};
  remote.updates = [];
  remote.delayMs = 0;
});

describe("useCelebration().complete", () => {
  it("persists the completion and returns a single-activity celebration", async () => {
    loadTrip(makeTrip([makeDay("d1", [makeActivity("a"), makeActivity("b")])]));
    const { result } = renderHook(() => useCelebration());
    let outcome: Awaited<ReturnType<typeof result.current.complete>> | undefined;
    await act(async () => { outcome = await result.current.complete("d1", "a"); });
    expect(outcome).toEqual({ ok: true, event: { id: 1, tier: 1, activityTitle: "Activity a" } });
    expect(stateOf("a")).toBe("completed");
    expect(remote.updates).toEqual([{ id: "a", state: "completed" }]);
  });

  it("celebrates the day, pointing to the next real pending day", async () => {
    loadTrip(makeTrip([
      makeDay("d1", [makeActivity("a", { state: "completed" }), makeActivity("b")]),
      makeDay("d2", []),
      makeDay("d3", [makeActivity("c")]),
    ]));
    const { result } = renderHook(() => useCelebration());
    let outcome: Awaited<ReturnType<typeof result.current.complete>> | undefined;
    await act(async () => { outcome = await result.current.complete("d1", "b"); });
    expect(outcome?.event).toMatchObject({ tier: 2, nextDayId: "d3" });
  });

  it("celebrates the trip only for its last pending activity", async () => {
    loadTrip(makeTrip([
      makeDay("d1", [makeActivity("a", { state: "completed" })]),
      makeDay("d2", [makeActivity("b")]),
    ]));
    const { result } = renderHook(() => useCelebration());
    let outcome: Awaited<ReturnType<typeof result.current.complete>> | undefined;
    await act(async () => { outcome = await result.current.complete("d2", "b"); });
    expect(outcome?.event?.tier).toBe(3);
  });

  it("never celebrates activities that were already completed when loaded", async () => {
    loadTrip(makeTrip([makeDay("d1", [makeActivity("a", { state: "completed" })])]));
    const { result } = renderHook(() => useCelebration());
    let outcome: Awaited<ReturnType<typeof result.current.complete>> | undefined;
    await act(async () => { outcome = await result.current.complete("d1", "a"); });
    expect(outcome).toEqual({ ok: true, event: null });
    expect(remote.updates).toEqual([]);
  });

  it("ignores repeated taps while the write is in flight", async () => {
    remote.delayMs = 20;
    loadTrip(makeTrip([makeDay("d1", [makeActivity("a"), makeActivity("b")])]));
    const { result } = renderHook(() => useCelebration());
    let outcomes: Awaited<ReturnType<typeof result.current.complete>>[] = [];
    await act(async () => {
      outcomes = await Promise.all([result.current.complete("d1", "a"), result.current.complete("d1", "a")]);
    });
    expect(outcomes.filter((o) => o.event)).toHaveLength(1);
    expect(remote.updates).toHaveLength(1);
  });

  it("still completes a different activity tapped right after", async () => {
    remote.delayMs = 20;
    loadTrip(makeTrip([makeDay("d1", [makeActivity("a"), makeActivity("b"), makeActivity("c")])]));
    const { result } = renderHook(() => useCelebration());
    await act(async () => {
      await Promise.all([result.current.complete("d1", "a"), result.current.complete("d1", "b")]);
    });
    expect(stateOf("a")).toBe("completed");
    expect(stateOf("b")).toBe("completed");
  });

  it("rolls back and skips the celebration when the write fails", async () => {
    remote.errors = { a: "network down" };
    loadTrip(makeTrip([makeDay("d1", [makeActivity("a"), makeActivity("b")])]));
    const { result } = renderHook(() => useCelebration());
    let outcome: Awaited<ReturnType<typeof result.current.complete>> | undefined;
    await act(async () => { outcome = await result.current.complete("d1", "a"); });
    expect(outcome).toEqual({ ok: false, event: null });
    expect(stateOf("a")).toBe("pending");
    // The global error would replace the whole trip screen.
    expect(useItineraryStore.getState().error).toBeNull();
  });
});

describe("updateActivityState rollback", () => {
  it("reverts only the failed activity, keeping a concurrent successful change", async () => {
    remote.errors = { a: "network down" };
    remote.delayMs = 10;
    loadTrip(makeTrip([makeDay("d1", [makeActivity("a"), makeActivity("b")])]));
    const { updateActivityState } = useItineraryStore.getState();
    const results = await Promise.all([
      updateActivityState("d1", "a", "completed"),
      updateActivityState("d1", "b", "completed"),
    ]);
    expect(results).toEqual([false, true]);
    expect(stateOf("a")).toBe("pending");
    expect(stateOf("b")).toBe("completed");
  });

  it("marks a completed activity as pending again", async () => {
    loadTrip(makeTrip([makeDay("d1", [makeActivity("a", { state: "completed" })])]));
    const ok = await useItineraryStore.getState().updateActivityState("d1", "a", "pending");
    expect(ok).toBe(true);
    expect(stateOf("a")).toBe("pending");
    expect(remote.updates).toEqual([{ id: "a", state: "pending" }]);
  });
});
