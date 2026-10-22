"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown,
  Luggage,
  CloudRain,
  Thermometer,
  Plus,
  RefreshCw,
  Check,
} from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import type {
  PackingCategory,
  PackingList,
  TravelContext,
  TripDay,
  WeatherSummary,
} from "@/lib/types";
import {
  buildActivityBreakdown,
  describeLuggage,
  getUniqueCities,
  loadPackingList,
  savePackingList,
  type PackingPromptInput,
} from "@/lib/packing-assistant";

type Props = {
  tripId: string;
  tripName: string;
  days: TripDay[];
  travelContext?: TravelContext;
};

export function PackingListCard({ tripId, tripName, days, travelContext }: Props) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PackingList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");

  // Determine if trip has dates
  const hasDates = days.length > 0 && days[0]?.date && days[days.length - 1]?.date;
  const cities = getUniqueCities(days);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = loadPackingList(tripId);
    if (saved) setList(saved);
  }, [tripId]);

  const fetchWeather = useCallback(async (): Promise<WeatherSummary[]> => {
    if (!hasDates) return [];
    const start = days[0].date;
    const end = days[days.length - 1].date;
    const summaries: WeatherSummary[] = [];

    for (const city of cities) {
      try {
        const res = await fetch(
          `/api/weather?city=${encodeURIComponent(city)}&start=${start}&end=${end}`,
        );
        if (res.ok) {
          summaries.push((await res.json()) as WeatherSummary);
        }
      } catch {
        // Skip city weather on failure
      }
    }
    return summaries;
  }, [cities, days, hasDates]);

  const generate = useCallback(async () => {
    if (!hasDates) return;
    setLoading(true);
    setError(null);

    try {
      const weatherSummaries = await fetchWeather();
      const start = days[0].date;
      const end = days[days.length - 1].date;
      const durationDays = Math.max(
        1,
        Math.ceil(
          (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24),
        ) + 1,
      );

      const input: PackingPromptInput = {
        cities,
        weatherSummaries,
        activityBreakdown: buildActivityBreakdown(days),
        luggageDescription: describeLuggage(travelContext),
        durationDays,
        travelerCount: travelContext?.travelerCount ?? 1,
        lang,
      };

      const res = await fetch("/api/packing-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) throw new Error("API error");

      const data = (await res.json()) as { categories: PackingCategory[] };
      const newList: PackingList = {
        tripId,
        generatedAt: new Date().toISOString(),
        weatherSummaries,
        categories: data.categories,
      };

      setList(newList);
      savePackingList(newList);
    } catch {
      setError(t("packing_error"));
    } finally {
      setLoading(false);
    }
  }, [hasDates, fetchWeather, days, cities, travelContext, tripId, lang, t]);

  const toggleItem = (categoryIndex: number, itemId: string) => {
    if (!list) return;
    const updated = {
      ...list,
      categories: list.categories.map((cat, ci) =>
        ci === categoryIndex
          ? {
              ...cat,
              items: cat.items.map((item) =>
                item.id === itemId
                  ? { ...item, status: item.status === "packed" ? "pending" as const : "packed" as const }
                  : item,
              ),
            }
          : cat,
      ),
    };
    setList(updated);
    savePackingList(updated);
  };

  const addManualItem = () => {
    if (!list || !newItemName.trim()) return;
    const firstCategory = list.categories[0];
    if (!firstCategory) return;

    const updated = {
      ...list,
      categories: list.categories.map((cat, i) =>
        i === 0
          ? {
              ...cat,
              items: [
                ...cat.items,
                {
                  id: `manual-${Date.now()}`,
                  name: newItemName.trim(),
                  quantity: 1,
                  reason: "Manually added",
                  status: "pending" as const,
                },
              ],
            }
          : cat,
      ),
    };
    setList(updated);
    savePackingList(updated);
    setNewItemName("");
  };

  // Stats
  const totalItems = list?.categories.reduce((sum, cat) => sum + cat.items.length, 0) ?? 0;
  const packedItems =
    list?.categories.reduce(
      (sum, cat) => sum + cat.items.filter((i) => i.status === "packed").length,
      0,
    ) ?? 0;

  return (
    <section className="mx-auto mt-5 w-full max-w-7xl px-5">
      <div className="rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm dark:border-sky-900/60 dark:from-sky-950/30 dark:to-slate-950 sm:p-6">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white">
            <Luggage size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
              {t("packing_title")}
            </p>
            <h2 className="mt-1 text-base font-black text-slate-900 dark:text-white">
              {tripName}
              {list && (
                <span className="ml-2 text-sm font-bold text-sky-600 dark:text-sky-400">
                  {t("packing_items_packed", { packed: String(packedItems), total: String(totalItems) })}
                </span>
              )}
            </h2>
          </div>
          <ChevronDown
            size={18}
            className={`mt-3 shrink-0 text-sky-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Collapsible body */}
        {open && (
          <div className="mt-4 space-y-4 pl-[52px]">
            {/* No dates hint */}
            {!hasDates && (
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {t("packing_no_dates")}
              </p>
            )}

            {/* Generate / Regenerate button */}
            {hasDates && !list && !loading && (
              <button
                type="button"
                onClick={generate}
                className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-black text-white hover:bg-sky-700"
              >
                {t("packing_generate")}
              </button>
            )}

            {loading && (
              <p className="text-xs font-bold text-sky-600 dark:text-sky-400 animate-pulse">
                {t("packing_generating")}
              </p>
            )}

            {error && (
              <p className="text-xs font-bold text-red-500">{error}</p>
            )}

            {/* Weather strip */}
            {list && list.weatherSummaries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {list.weatherSummaries.map((w) => (
                  <div
                    key={w.city}
                    className="flex items-center gap-1.5 rounded-xl border border-sky-100/80 bg-white/70 px-3 py-1.5 dark:border-sky-900/40 dark:bg-slate-900/60"
                  >
                    <Thermometer size={12} className="text-sky-500" />
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                      {w.city}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {w.tempMinC}–{w.tempMaxC}°C
                    </span>
                    {w.rainProbabilityMax > 30 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-sky-600 dark:text-sky-400">
                        <CloudRain size={10} />
                        {w.rainProbabilityMax}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Packing categories */}
            {list && list.categories.map((cat, ci) => (
              <section
                key={cat.name}
                className="rounded-2xl border border-sky-100/80 bg-white/70 p-4 dark:border-sky-900/40 dark:bg-slate-900/60"
              >
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  {cat.name}
                </h3>
                <div className="mt-2 space-y-1.5">
                  {cat.items.map((item) => (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => toggleItem(ci, item.id)}
                        className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          item.status === "packed"
                            ? "border-sky-500 bg-sky-500 text-white"
                            : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                        }`}
                      >
                        {item.status === "packed" && <Check size={12} />}
                      </button>
                      <span
                        className={`text-xs font-bold ${
                          item.status === "packed"
                            ? "text-slate-400 line-through dark:text-slate-500"
                            : "text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {item.quantity > 1 && (
                          <span className="mr-1 text-sky-600 dark:text-sky-400">
                            {item.quantity}×
                          </span>
                        )}
                        {item.name}
                      </span>
                      {item.reason && (
                        <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 hidden sm:inline">
                          {item.reason}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))}

            {/* Manual add */}
            {list && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addManualItem()}
                  placeholder={t("packing_add_item_placeholder")}
                  className="min-w-0 flex-1 rounded-xl border border-sky-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 placeholder-slate-400 outline-none focus:border-sky-400 dark:border-sky-800 dark:bg-slate-900 dark:text-slate-200 dark:placeholder-slate-500"
                />
                <button
                  type="button"
                  onClick={addManualItem}
                  disabled={!newItemName.trim()}
                  className="flex items-center gap-1 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-black text-white hover:bg-sky-700 disabled:opacity-40"
                >
                  <Plus size={12} />
                  {t("packing_add_item")}
                </button>
              </div>
            )}

            {/* Regenerate + generated-at footer */}
            {list && hasDates && (
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {t("packing_generated_at", {
                    date: new Date(list.generatedAt).toLocaleDateString(),
                  })}
                </p>
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-sky-600 hover:text-sky-700 dark:text-sky-400 disabled:opacity-40"
                >
                  <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
                  {t("packing_regenerate")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
