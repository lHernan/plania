import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import { optimizeDay } from "@/lib/ai/optimizer";
import type { Activity, TripDay } from "@/lib/types";

// Same lookup and {var} replacement as I18nProvider's t().
const translator = (dict: Record<string, string>) => (key: string, vars: Record<string, string | number> = {}) =>
  Object.entries(vars).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dict[key] ?? key);

const activity = (id: string, title: string, time: string, durationMin: number, extra: Partial<Activity> = {}): Activity => ({
  id, dayId: "d1", tripId: "t", userId: "u", city: "Santa Cruz", title, time, durationMin,
  category: "sightseeing", priority: "medium", state: "pending", sort_order: 0, ...extra,
});

const day: TripDay = {
  id: "d1", date: "2026-10-30", city: "Santa Cruz",
  activities: [
    activity("a", "Llegada al aeropuerto", "08:00", 30),
    activity("b", "Recoger coche", "08:30", 45),
    activity("c", "Almuerzo", "09:00", 60, { category: "photos" }),
    activity("d", "Entradas observatorio", "13:00", 60, { category: "reservation" }),
  ],
} as TripDay;

describe("optimizeDay", () => {
  it("writes every note in Spanish when the app is in Spanish", () => {
    expect(optimizeDay(day, translator(es)).map(({ title, reason }) => ({ title, reason }))).toEqual([
      { title: "Traslado justo entre Llegada al aeropuerto y Recoger coche", reason: "Deja margen para retrasos del transporte y caminatas." },
      { title: "Conflicto de horario: Recoger coche se solapa con Almuerzo", reason: "Mueve una de las dos actividades para evitar horarios imposibles." },
      { title: "Lleva las fotos cerca de la hora dorada", reason: "La mejor luz para miradores y vistas de la ciudad." },
      { title: "Reserva pronto las franjas pendientes", reason: "Los horarios con mucha demanda se agotan en temporada alta." },
    ]);
  });

  it("keeps the English notes when the app is in English", () => {
    expect(optimizeDay(day, translator(en)).map(({ id, title, reason, impact }) => ({ id, title, reason, impact }))).toEqual([
      { id: "tight-a", title: "Tight transfer between Llegada al aeropuerto and Recoger coche", reason: "Add buffer for transport delays and walking.", impact: "comfort" },
      { id: "overlap-b", title: "Schedule conflict: Recoger coche overlaps with Almuerzo", reason: "Move one activity to avoid impossible timing.", impact: "time" },
      { id: "photo-golden-hour", title: "Move photo spots near golden hour", reason: "Best light for views and city skyline shots.", impact: "comfort" },
      { id: "bookings-first", title: "Book pending reservation windows early", reason: "High-demand slots sell out quickly in peak season.", impact: "time" },
    ]);
  });
});
