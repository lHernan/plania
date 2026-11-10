// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { makeActivity, makeDay, makeTrip, mockMatchMedia, renderWithI18n } from "./helpers/dom";
import type { TripMember, TripPlan } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/t",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="day-map" /> }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no" } }) }) },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));
vi.mock("@/components/CriticalReservationsPanel", () => ({ CriticalReservationsPanel: () => <section /> }));
vi.mock("@/components/ShoppingListPanel", () => ({ ShoppingListPanel: () => <section /> }));
vi.mock("@/components/ArrivalAssistant", () => ({ ArrivalAssistant: () => null }));
vi.mock("@/components/CityPaymentGuideCard", () => ({ CityPaymentGuideCard: () => null }));
vi.mock("@/components/CurrencyConverter", () => ({ CurrencyConverter: () => null }));
vi.mock("@/components/EmergencyInfoCard", () => ({ EmergencyInfoCard: () => null }));
vi.mock("@/components/PackingListCard", () => ({ PackingListCard: () => <section /> }));
vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/TripSwitcher", () => ({ TripSwitcher: () => null }));
vi.mock("@/components/ProductTour", () => ({
  ProductTour: () => null,
  useProductTour: () => ({ open: false, start: vi.fn(), close: vi.fn() }),
}));

const { TripView, ActivityEditModal } = await import("@/components/TripView");
const { clearTripMembersCache } = await import("@/components/memories/use-trip-members");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

// The spec's trip: two flights to Madrid for different people, plus a shared walk.
const MEMBERS: TripMember[] = [
  { userId: "me", email: "hernan@x.io", isOwner: true, displayName: "Hernán L" },
  { userId: "jack", email: "jackeline@x.io", isOwner: false, displayName: "Jackeline" },
  { userId: "maria", email: "maria@x.io", isOwner: false },
];
const loadTripMembers = vi.fn(async () => ({ members: MEMBERS }));

async function show(members = MEMBERS) {
  loadTripMembers.mockImplementation(async () => ({ members }));
  const day = makeDay("d1", [
    makeActivity("walk", { title: "Paseo por Madrid", time: "18:00" }),
    makeActivity("tfn", { title: "Vuelo Tenerife – Madrid", time: "08:00", participantIds: ["me", "jack"] }),
    makeActivity("bog", { title: "Vuelo Colombia – Madrid", time: "09:00", participantIds: ["maria"] }),
  ]);
  const trip: TripPlan = { ...makeTrip([day]), id: "t", userId: "me", memories: [] };
  useItineraryStore.setState({
    activeTrip: trip,
    activeDayId: "d1",
    activeTripIsDraft: false,
    loading: false,
    error: null,
    hasFetched: true,
    fetchActiveTrip: vi.fn(async () => {}),
    loadTripMembers,
  } as never);
  useAuthStore.setState({ user: { id: "me", is_anonymous: false, email: "hernan@x.io" } } as never);
  renderWithI18n(<TripView />);
  await act(async () => {});
}

const visible = () => ["walk", "tfn", "bog"].filter((id) => document.getElementById(`activity-${id}`));

beforeEach(() => {
  mockMatchMedia();
  clearTripMembersCache();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("itinerary filter by person", () => {
  it("'Todos' is the default and shows every activity of the trip", async () => {
    await show();
    expect(screen.getByRole("radio", { name: "Todos" }).getAttribute("aria-checked")).toBe("true");
    expect(visible()).toEqual(["walk", "tfn", "bog"]);
  });

  it("'Mi itinerario' shows the shared activities and mine, never other people's flights", async () => {
    await show();
    fireEvent.click(screen.getByRole("radio", { name: /Mi itinerario/ }));
    expect(visible()).toEqual(["walk", "tfn"]);
  });

  it("another person's itinerary shows the shared activities and theirs", async () => {
    await show();
    fireEvent.click(screen.getByRole("radio", { name: /maria/ }));
    expect(visible()).toEqual(["walk", "bog"]);
    fireEvent.click(screen.getByRole("radio", { name: /Jackeline/ }));
    expect(visible()).toEqual(["walk", "tfn"]);
  });

  it("remembers the choice for the trip on this device", async () => {
    await show();
    fireEvent.click(screen.getByRole("radio", { name: /maria/ }));
    cleanup();
    await show();
    expect(screen.getByRole("radio", { name: /maria/ }).getAttribute("aria-checked")).toBe("true");
    expect(visible()).toEqual(["walk", "bog"]);
  });

  it("is hidden on a trip with one person", async () => {
    await show([MEMBERS[0]]);
    expect(screen.queryByRole("radiogroup", { name: "Itinerario de" })).toBeNull();
    expect(visible()).toEqual(["walk", "tfn", "bog"]);
  });

  it("assigned activities name their people; shared ones show nobody", async () => {
    await show();
    expect(document.getElementById("activity-tfn")?.textContent).toContain("Hernán · Jackeline");
    expect(document.getElementById("activity-bog")?.textContent).toContain("maria");
    expect(document.getElementById("activity-walk")?.textContent).not.toContain("Asignada a estas personas");
    expect(document.getElementById("activity-tfn")?.textContent).toContain("Asignada a estas personas");
  });
});

describe("assigning an activity in its editor", () => {
  const renderModal = (participantIds: string[] | undefined, canAssign = true) => {
    const onSaveParticipants = vi.fn();
    const onSave = vi.fn();
    renderWithI18n(
      <ActivityEditModal
        activity={makeActivity("tfn", { title: "Vuelo", participantIds })}
        currency="EUR"
        onClose={() => {}}
        onSave={onSave}
        onDelete={() => {}}
        onDuplicate={() => {}}
        onPreviewFile={() => {}}
        members={MEMBERS}
        currentUserId="me"
        canAssign={canAssign}
        onSaveParticipants={onSaveParticipants}
      />
    );
    return { onSaveParticipants, onSave };
  };
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Guardar Cambios" }));

  it("'Todos' is selected by default", () => {
    renderModal(undefined);
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("picking people makes it theirs only, and saves that assignment", () => {
    const { onSaveParticipants } = renderModal([]);
    fireEvent.click(screen.getByRole("button", { name: /Yo/ }));
    fireEvent.click(screen.getByRole("button", { name: /Jackeline/ }));
    expect(screen.getByRole("button", { name: "Todos" }).getAttribute("aria-pressed")).toBe("false");
    save();
    expect(onSaveParticipants).toHaveBeenCalledWith(["me", "jack"]);
  });

  it("'Todos' makes it shared again", () => {
    const { onSaveParticipants } = renderModal(["maria"]);
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    save();
    expect(onSaveParticipants).toHaveBeenCalledWith([]);
  });

  it("does not write the assignment when it did not change", () => {
    const { onSaveParticipants, onSave } = renderModal(["maria"]);
    save();
    expect(onSave).toHaveBeenCalled();
    expect(onSaveParticipants).not.toHaveBeenCalled();
  });

  it("viewers see the assignment but cannot change it", () => {
    const { onSaveParticipants } = renderModal(["maria"], false);
    expect((screen.getByRole("button", { name: /maria/ }) as HTMLButtonElement).disabled).toBe(true);
    save();
    expect(onSaveParticipants).not.toHaveBeenCalled();
  });
});
