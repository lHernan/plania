// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";

type Handler = (payload: unknown) => void;
type Binding = { event: string; config: Record<string, string>; handler: Handler };

/** A fake realtime client: every channel records its bindings and whether it was removed. */
const rt = vi.hoisted(() => ({
  channels: [] as { name: string; bindings: Binding[]; subscribed: boolean; removed: boolean; onStatus?: (status: string) => void }[],
  enabled: true,
  participants: { data: [] as unknown[] | null, error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase", () => {
  const supabase: Record<string, unknown> = {
    from: () => {
      const q = { select: () => q, eq: () => q, then: (resolve: (r: unknown) => void) => resolve(rt.participants) };
      return q;
    },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    removeChannel: async (channel: { record: { removed: boolean } }) => {
      channel.record.removed = true;
      return "ok";
    },
  };
  Object.defineProperty(supabase, "channel", {
    get: () =>
      rt.enabled
        ? (name: string) => {
            const record = { name, bindings: [] as Binding[], subscribed: false, removed: false } as (typeof rt.channels)[number];
            rt.channels.push(record);
            const channel = {
              record,
              on(event: string, config: Record<string, string>, handler: Handler) {
                record.bindings.push({ event, config, handler });
                return channel;
              },
              subscribe(onStatus?: (status: string) => void) {
                record.subscribed = true;
                record.onStatus = onStatus;
                return channel;
              },
            };
            return channel;
          }
        : undefined,
  });
  return { supabase };
});

const refresh = vi.hoisted(() => vi.fn());
const known = vi.hoisted(() => ({ expenses: null as string[] | null, settlements: null as string[] | null }));
vi.mock("@/hooks/use-trip-expenses", () => ({
  refreshTripExpenses: refresh,
  // null = nothing loaded yet for the trip.
  tripExpensesHas: (_tripId: string, row: { expenseId?: string; settlementId?: string }) => {
    const list = row.expenseId ? known.expenses : known.settlements;
    return list === null ? undefined : list.includes((row.expenseId ?? row.settlementId)!);
  },
}));

const { useTripRealtime } = await import("@/hooks/use-trip-realtime");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useOfflineStore } = await import("@/store/use-offline-store");

const realRefreshParticipants = useItineraryStore.getState().refreshActivityParticipants;
const refreshParticipants = vi.fn(async () => {});
const fire = (table: string) => {
  const binding = rt.channels.at(-1)!.bindings.find((entry) => entry.config.table === table)!;
  binding.handler({ eventType: "INSERT" });
};
/** A DELETE as Supabase sends it: unfiltered, with only the primary key in old. */
const fireDelete = (table: string, old: Record<string, string>) => {
  const binding = rt.channels.at(-1)!.bindings.find((entry) => entry.config.table === table && entry.config.event === "DELETE")
    ?? rt.channels.at(-1)!.bindings.find((entry) => entry.config.table === table)!;
  binding.handler({ eventType: "DELETE", old });
};

beforeEach(() => {
  vi.useFakeTimers();
  rt.channels = [];
  rt.enabled = true;
  refresh.mockReset();
  known.expenses = null;
  known.settlements = null;
  refreshParticipants.mockClear();
  useItineraryStore.setState({ refreshActivityParticipants: refreshParticipants } as never);
  useOfflineStore.setState({ isOnline: true } as never);
});
afterEach(() => vi.useRealTimers());

describe("useTripRealtime", () => {
  it("subscribes to the trip's expenses, splits, settlements and assignments", () => {
    renderHook(() => useTripRealtime("t1", true));
    expect(rt.channels).toHaveLength(1);
    const [channel] = rt.channels;
    expect(channel.name).toBe("trip-sync:t1");
    expect(channel.subscribed).toBe(true);
    expect(channel.bindings.map((b) => [b.event, b.config.event, b.config.schema, b.config.table, b.config.filter])).toEqual([
      ["postgres_changes", "*", "public", "expenses", "trip_id=eq.t1"],
      // No trip_id column: RLS limits the rows each member receives.
      ["postgres_changes", "*", "public", "expense_splits", undefined],
      ["postgres_changes", "*", "public", "expense_settlements", "trip_id=eq.t1"],
      ["postgres_changes", "*", "public", "activity_participants", "trip_id=eq.t1"],
      // Supabase never delivers DELETE events to a filtered subscription.
      ["postgres_changes", "DELETE", "public", "expense_settlements", undefined],
      ["postgres_changes", "DELETE", "public", "activity_participants", undefined],
    ]);
  });

  it("refreshes the expenses once per burst of changes", () => {
    renderHook(() => useTripRealtime("t1", true));
    fire("expenses");
    fire("expense_splits");
    fire("expense_splits");
    fire("expense_settlements");
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("t1");
    expect(refreshParticipants).not.toHaveBeenCalled();
  });

  it("reloads the assignments when they change", () => {
    renderHook(() => useTripRealtime("t1", true));
    fire("activity_participants");
    fire("activity_participants");
    act(() => vi.advanceTimersByTime(300));
    expect(refreshParticipants).toHaveBeenCalledTimes(1);
    expect(refreshParticipants).toHaveBeenCalledWith("t1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount and when the trip changes, dropping pending refreshes", () => {
    const { rerender, unmount } = renderHook(({ tripId }) => useTripRealtime(tripId, true), { initialProps: { tripId: "t1" } });
    fire("expenses");
    rerender({ tripId: "t2" });
    expect(rt.channels[0].removed).toBe(true);
    expect(rt.channels[1].name).toBe("trip-sync:t2");
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).not.toHaveBeenCalled();
    unmount();
    expect(rt.channels[1].removed).toBe(true);
  });

  it("catches up once subscribed, so a reopened trip or a reconnection never shows stale data", () => {
    renderHook(() => useTripRealtime("t1", true));
    act(() => rt.channels[0].onStatus?.("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).toHaveBeenCalledWith("t1");
    expect(refreshParticipants).toHaveBeenCalledWith("t1");
  });

  it("ignores unfiltered deletes that belong to other trips", () => {
    useItineraryStore.setState({ activeTrip: { ...makeTrip([makeDay("d1", [makeActivity("walk")])]), id: "t1" } } as never);
    known.expenses = ["e1"];
    known.settlements = ["s1"];
    renderHook(() => useTripRealtime("t1", true));
    fireDelete("expense_splits", { expense_id: "other-trip-expense", user_id: "u" });
    fireDelete("expense_settlements", { id: "other-trip-settlement" });
    fireDelete("activity_participants", { activity_id: "other-trip-activity", user_id: "u" });
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshParticipants).not.toHaveBeenCalled();

    fireDelete("expense_splits", { expense_id: "e1", user_id: "u" });
    fireDelete("activity_participants", { activity_id: "walk", user_id: "u" });
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshParticipants).toHaveBeenCalledTimes(1);
    fireDelete("expense_settlements", { id: "s1" });
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("reloads on a delete it cannot place (nothing loaded yet or no key)", () => {
    renderHook(() => useTripRealtime("t1", true));
    fireDelete("expense_settlements", {});
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a draft, offline or without realtime", () => {
    renderHook(() => useTripRealtime("t1", false));
    useOfflineStore.setState({ isOnline: false } as never);
    renderHook(() => useTripRealtime("t1", true));
    useOfflineStore.setState({ isOnline: true } as never);
    rt.enabled = false;
    renderHook(() => useTripRealtime("t1", true));
    renderHook(() => useTripRealtime("", true));
    expect(rt.channels).toEqual([]);
  });
});

describe("refreshActivityParticipants", () => {
  const openTrip = () => {
    const day = makeDay("d1", [
      makeActivity("walk", { participantIds: ["ana"] }),
      makeActivity("tfn", { participantIds: [] }),
      makeActivity("offline-1", { participantIds: ["maria"] }),
    ]);
    useItineraryStore.setState({ activeTrip: { ...makeTrip([day]), id: "t1", userId: null }, refreshActivityParticipants: realRefreshParticipants } as never);
  };
  const assignments = () =>
    Object.fromEntries(useItineraryStore.getState().activeTrip!.days[0].activities.map((activity) => [activity.id, activity.participantIds]));

  it("merges the fresh assignments into the open trip, keeping activities not synced yet", async () => {
    openTrip();
    rt.participants = { data: [{ activity_id: "tfn", user_id: "me" }, { activity_id: "tfn", user_id: "jack" }], error: null };
    await useItineraryStore.getState().refreshActivityParticipants("t1");
    expect(assignments()).toEqual({ walk: [], tfn: ["me", "jack"], "offline-1": ["maria"] });
  });

  it("keeps what is on screen when the read fails or another trip is open", async () => {
    openTrip();
    rt.participants = { data: null, error: { message: "boom" } };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await useItineraryStore.getState().refreshActivityParticipants("t1");
    rt.participants = { data: [{ activity_id: "walk", user_id: "me" }], error: null };
    await useItineraryStore.getState().refreshActivityParticipants("other");
    expect(assignments()).toEqual({ walk: ["ana"], tfn: [], "offline-1": ["maria"] });
  });
});
