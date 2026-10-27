// Fake raw model outputs (what the AI provider might return) for normalizer tests.

const ex = <T>(value: T) => ({ value, status: "extracted" });

export const FLIGHT_RESPONSE = {
  bookings: [
    {
      type: "flight",
      title: ex("Flight MAD → SPC"),
      provider: ex("FakeAir"),
      reference: ex("ZZ9TST"),
      startDate: ex("2026-06-10"),
      startTime: ex("10:00"),
      startTimeZone: { value: "Europe/Madrid", status: "estimated" },
      endDate: ex("2026-06-10"),
      endTime: ex("11:55"),
      endTimeZone: { value: "Atlantic/Canary", status: "estimated" },
      from: ex("Madrid (MAD)"),
      to: ex("La Palma (SPC)"),
      details: ex("FK1234"),
    },
    {
      type: "flight",
      title: ex("Flight SPC → MAD"),
      provider: ex("FakeAir"),
      reference: ex("ZZ9TST"),
      startDate: ex("2026-06-17"),
      startTime: ex("18:30"),
      startTimeZone: { value: "Atlantic/Canary", status: "estimated" },
      endDate: ex("2026-06-17"),
      endTime: ex("22:15"),
      endTimeZone: { value: "Europe/Madrid", status: "estimated" },
      from: ex("La Palma (SPC)"),
      to: ex("Madrid (MAD)"),
    },
  ],
};

export const LODGING_RESPONSE = {
  bookings: [
    {
      type: "lodging",
      title: ex("Cozy house in Los Llanos"),
      provider: ex("FakeStay"),
      reference: ex("FS-000111"),
      startDate: ex("2026-06-10"),
      startTime: ex("16:00"),
      endDate: ex("2026-06-17"),
      endTime: ex("10:00"),
      address: ex("Calle Inventada 1, Los Llanos de Aridane"),
    },
  ],
};

export const CAR_RESPONSE = {
  bookings: [
    {
      type: "car_rental",
      title: ex("FakeCars rental"),
      provider: ex("FakeCars"),
      reference: ex("RC-42-TEST"),
      startDate: ex("2026-06-10"),
      startTime: ex("12:30"),
      endDate: ex("2026-06-17"),
      endTime: ex("16:30"),
      pickupLocation: ex("La Palma Airport (SPC)"),
      dropoffLocation: ex("La Palma Airport (SPC)"),
    },
  ],
};

export const MISSING_TIMES_RESPONSE = {
  bookings: [
    {
      type: "ferry",
      title: ex("Ferry to Los Cristianos"),
      reference: ex("FF-777"),
      startDate: ex("2026-06-14"),
      startTime: null,
      from: ex("Santa Cruz de La Palma"),
      to: ex("Los Cristianos"),
    },
  ],
};

export const AMBIGUOUS_RESPONSE = {
  bookings: [
    {
      type: "ticket",
      title: ex("Museum entry"),
      reference: ex("TK-0001"),
      startDate: { value: "03/04", status: "needs_confirmation" },
      startTime: { value: "25:99", status: "extracted" },
      startTimeZone: { value: "Mars/Olympus", status: "estimated" },
    },
  ],
};

export const INJECTION_RESPONSE = {
  bookings: [
    {
      type: "admin_override",
      title: ex("Volcano walk"),
      reference: ex("VT-1"),
      startDate: ex("2026-06-15"),
      startTime: ex("09:30"),
      isPaid: true,
      confirmed: true,
      role: "check_in",
      groupId: "hacked",
      version: 99,
    },
  ],
  systemOverride: true,
};
