import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDayWeather, weatherCondition } from "@/lib/weather/day-forecast";

const forecast = {
  hourly: {
    time: ["2026-11-02T11:00", "2026-11-02T12:00", "2026-11-02T13:00", "2026-11-02T14:00", "2026-11-02T22:00", "2026-11-03T12:00"],
    temperature_2m: [20.4, 21, 19.6, 18.9, 17, 22],
    precipitation_probability: [10, 20, 80, 90, 30, 5],
    precipitation: [0, 0, 1.2, 3.4, 0, 0],
    weather_code: [1, 3, 61, 63, 2, 0],
  },
  daily: {
    time: ["2026-11-02", "2026-11-03"],
    weather_code: [63, 1],
    precipitation_probability_max: [90, 5],
    temperature_2m_max: [21, 23],
    temperature_2m_min: [16, 17],
  },
};

describe("fetchDayWeather", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const base = { city: "La Palma", date: "2026-11-02", fromTime: "12:20", dayEnd: "22:00", otherDates: ["2026-11-03"], today: "2026-11-02" };

  it("returns the remaining hours of the day and the outlook of the other days", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(forecast)));
    const weather = await fetchDayWeather({ ...base, coords: { lat: 28.68, lng: -17.76 } });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("28.68");
    expect(url.searchParams.get("start_date")).toBe("2026-11-02");
    expect(url.searchParams.get("end_date")).toBe("2026-11-03");
    expect(url.searchParams.get("timezone")).toBe("auto");

    // The 12:00 hour is still running at 12:20, so it counts.
    expect(weather?.hours).toEqual([
      { time: "12:00", condition: "cloudy", precipProbability: 20, precipMm: 0, tempC: 21 },
      { time: "13:00", condition: "rain", precipProbability: 80, precipMm: 1.2, tempC: 19.6 },
      { time: "14:00", condition: "rain", precipProbability: 90, precipMm: 3.4, tempC: 18.9 },
      { time: "22:00", condition: "cloudy", precipProbability: 30, precipMm: 0, tempC: 17 },
    ]);
    expect(weather?.days).toEqual([{ date: "2026-11-03", condition: "clear", precipProbabilityMax: 5, tempMaxC: 23, tempMinC: 17 }]);
  });

  it("geocodes the city when there are no coordinates", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ latitude: 28.68, longitude: -17.76, name: "La Palma" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(forecast)));
    const weather = await fetchDayWeather(base);
    expect(new URL(fetchMock.mock.calls[0][0] as string).hostname).toBe("geocoding-api.open-meteo.com");
    expect(weather?.hours.length).toBeGreaterThan(0);
  });

  it("returns null beyond the forecast range or when the service fails", async () => {
    expect(await fetchDayWeather({ ...base, date: "2026-12-30", today: "2026-11-02" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect(await fetchDayWeather({ ...base, coords: { lat: 1, lng: 1 } })).toBeNull();

    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchDayWeather({ ...base, coords: { lat: 1, lng: 1 } })).toBeNull();
  });

  it("only asks for other days inside the forecast range", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(forecast)));
    await fetchDayWeather({ ...base, coords: { lat: 1, lng: 1 }, otherDates: ["2026-11-03", "2026-12-30"] });
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("end_date")).toBe("2026-11-03");
  });
});

describe("weatherCondition", () => {
  it.each([
    [0, "clear"], [1, "clear"], [2, "cloudy"], [3, "cloudy"], [45, "fog"], [53, "drizzle"],
    [61, "rain"], [81, "rain"], [66, "rain"], [71, "snow"], [86, "snow"], [95, "storm"], [null, "unknown"],
  ])("maps WMO code %s to %s", (code, condition) => {
    expect(weatherCondition(code)).toBe(condition);
  });
});
