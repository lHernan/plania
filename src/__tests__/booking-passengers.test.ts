import { describe, expect, it } from "vitest";
import { buildExtractionSystemPrompt, normalizeExtractedBookings, type ExtractedBooking } from "@/lib/bookings/extract";
import { buildBookingActivities, createReviewItems, passengersPatch } from "@/lib/bookings/import-session";
import type { Activity, TripDay } from "@/lib/types";

const SHA = (n: number) => String(n).repeat(64);

describe("passengers in the extraction", () => {
  it("asks the model for the passengers and keeps only clean ones", () => {
    expect(buildExtractionSystemPrompt("es")).toContain('"passengers"');
    const [booking] = normalizeExtractedBookings(
      {
        bookings: [{
          type: "flight",
          title: { value: "Vuelo BOG → MAD", status: "extracted" },
          startDate: { value: "2026-12-10", status: "extracted" },
          passengers: [
            { name: "  Ana García  ", seat: "14C", ticket: "075 2400123456" },
            { name: "Luis García", seat: null },
            { name: "" },
            "not an object",
            { name: "x".repeat(200) },
          ],
        }],
      },
      { fileName: "ana.pdf", sha256: SHA(1) },
    );
    expect(booking.passengers).toEqual([
      { name: "Ana García", seat: "14C", ticket: "075 2400123456" },
      { name: "Luis García" },
      { name: "x".repeat(80) },
    ]);
  });

  it("leaves passengers out when there are none", () => {
    const [booking] = normalizeExtractedBookings({ bookings: [{ type: "flight", title: "Vuelo" }] }, { fileName: "a.pdf", sha256: SHA(2) });
    expect(booking.passengers).toBeUndefined();
  });
});

const days: TripDay[] = [
  { id: "d1", date: "2026-12-10", city: "Bogotá", label: "", activities: [], userId: "u" },
  { id: "d2", date: "2027-01-08", city: "Madrid", label: "", activities: [], userId: "u" },
];

/** One Iberia booking (same locator) issued per passenger: outbound and return in each PDF. */
function passengerPdf(n: number, name: string, seats: [string, string]): { fileId: string; bookings: ExtractedBooking[] } {
  const base = { type: "flight" as const, provider: "Iberia", reference: "XK7Q2P", fieldStatus: { title: "extracted" as const, startDate: "extracted" as const, startTime: "extracted" as const }, warnings: [], source: { fileName: `p${n}.pdf`, sha256: SHA(n) } };
  return {
    fileId: `file-${n}`,
    bookings: [
      { ...base, id: `${n}-out`, title: "Vuelo BOG → MAD", from: "BOG", to: "MAD", start: { date: "2026-12-10", time: "19:35" }, end: { date: "2026-12-11", time: "12:40" }, passengers: [{ name, seat: seats[0] }] },
      { ...base, id: `${n}-back`, title: "Vuelo MAD → BOG", from: "MAD", to: "BOG", start: { date: "2027-01-08", time: "12:05" }, end: { date: "2027-01-08", time: "16:10" }, passengers: [{ name, seat: seats[1] }] },
    ],
  };
}

describe("several travelers on the same booking", () => {
  const results = [passengerPdf(1, "Ana García", ["14C", "22A"]), passengerPdf(2, "Luis García", ["14D", "22B"]), passengerPdf(3, "Sofía García", ["14E", "22C"])];

  it("groups the passengers of each flight into one flight to import", () => {
    const items = createReviewItems(results, []);
    const included = items.filter((i) => i.included);
    expect(included.map((i) => i.id)).toEqual(["1-out", "1-back"]);
    expect(included[0].booking.passengers).toEqual([
      { name: "Ana García", seat: "14C" },
      { name: "Luis García", seat: "14D" },
      { name: "Sofía García", seat: "14E" },
    ]);
    expect(included[1].booking.passengers?.map((p) => p.seat)).toEqual(["22A", "22B", "22C"]);
    const merged = items.find((i) => i.id === "2-out")!;
    expect(merged).toMatchObject({ included: false, duplicate: { kind: "batch", matchId: "1-out", reason: "reference" } });
  });

  it("lists the passengers in the notes and attaches every passenger's PDF to the flight", () => {
    const { activities, uploads, attachments } = buildBookingActivities(createReviewItems(results, []), days, "es");
    expect(activities.map((a) => a.title)).toEqual(["Vuelo BOG → MAD", "Vuelo MAD → BOG"]);
    expect(activities[0].notes).toContain("Pasajeros:\n- Ana García · asiento 14C\n- Luis García · asiento 14D\n- Sofía García · asiento 14E");
    expect(activities[0].booking?.passengers).toHaveLength(3);
    expect(uploads).toEqual([
      { fileId: "file-1", activityIndex: 0 },
      { fileId: "file-2", activityIndex: 0 },
      { fileId: "file-3", activityIndex: 0 },
    ]);
    expect(attachments).toEqual([]);
  });
});

describe("a boarding pass for a flight already in the trip", () => {
  const saved: Activity = {
    id: "act-flight", dayId: "d1", tripId: "t", userId: "u", city: "Bogotá", title: "Vuelo BOG → MAD", time: "19:35", durationMin: 60,
    category: "transport", priority: "critical", state: "pending", sort_order: 0, origin: "booking",
    booking: {
      version: 1, type: "flight", role: "departure", groupId: "g", title: "Vuelo BOG → MAD", reference: "XK7Q2P", from: "BOG", to: "MAD",
      start: { date: "2026-12-10", time: "19:35" }, fieldStatus: {}, passengers: [{ name: "Ana García", seat: "14C" }],
    },
  };
  const pass = { fileId: "pass-1", bookings: [passengerPdf(2, "Luis García", ["14D", "22B"]).bookings[0]] };

  it("attaches the PDF to that flight and adds the new passenger instead of dropping it", () => {
    const items = createReviewItems([pass], [saved]);
    expect(items[0]).toMatchObject({ included: false, duplicate: { kind: "existing", matchId: "act-flight" } });
    const { activities, uploads, attachments } = buildBookingActivities(items, days, "es");
    expect(activities).toEqual([]);
    expect(uploads).toEqual([]);
    expect(attachments).toEqual([
      { fileId: "pass-1", activityId: "act-flight", passengers: [{ name: "Ana García", seat: "14C" }, { name: "Luis García", seat: "14D" }] },
    ]);
  });

  it("does not attach when the traveler chose to import it as its own booking", () => {
    const items = createReviewItems([pass], [saved]).map((i) => ({ ...i, included: true }));
    expect(buildBookingActivities(items, days, "es").attachments).toEqual([]);
  });
});

describe("passengersPatch", () => {
  const NL = String.fromCharCode(10);
  const flight = {
    id: "act", dayId: "d1", tripId: "t", userId: "u", city: "Bogotá", title: "Vuelo", time: "19:35", durationMin: 60,
    category: "transport", priority: "critical", state: "pending", sort_order: 0, origin: "booking",
    notes: ["Localizador: XK7Q2P", "Pasajeros:", "- Ana García · asiento 14C", "Terminal 1"].join(NL),
    booking: { version: 1, type: "flight", role: "departure", groupId: "g", title: "Vuelo", fieldStatus: {}, passengers: [{ name: "Ana García", seat: "14C" }] },
  } as Activity;

  it("updates the booking and replaces the passenger list in the notes, keeping the rest", () => {
    const patch = passengersPatch(flight, [{ name: "Ana García", seat: "14C" }, { name: "Luis García", seat: "14D" }], "es");
    expect(patch?.booking?.passengers).toHaveLength(2);
    expect(patch?.notes).toBe(["Localizador: XK7Q2P", "Terminal 1", "Pasajeros:", "- Ana García · asiento 14C", "- Luis García · asiento 14D"].join(NL));
  });

  it("changes nothing when nobody new comes along", () => {
    expect(passengersPatch(flight, [{ name: "Ana García", seat: "14C" }], "es")).toBeNull();
  });
});
