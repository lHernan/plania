"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChevronDown,
  Luggage,
  CloudRain,
  Thermometer,
  Plus,
  RefreshCw,
  Check,
  X,
} from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { authHeaders } from "@/lib/auth-headers";
import { isTripUndated } from "@/lib/trip-undated";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { TachiAvatar } from "@/components/TachiAvatar";
import type {
  PackingCategory,
  PackingList,
  PackingScope,
  TravelContext,
  TripShareUser,
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
import { buildPackingList, fetchTripShares, loadPackingMode, savePackingMode } from "@/lib/packing-sync";

type Props = {
  tripId: string;
  tripName: string;
  days: TripDay[];
  travelContext?: TravelContext;
  /** Generating calls the AI, which is for registered users only: guests are asked to sign in. */
  onRequireAuth?: () => void;
  /** Starts expanded: Tachi's "Generate packing list" lands here. */
  defaultOpen?: boolean;
};

export function PackingListCard({ tripId, tripName, days, travelContext, onRequireAuth, defaultOpen = false }: Props) {
  const { lang, t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const [open, setOpen] = useState(defaultOpen);
  // Device-only list: the sample trip, guests without a saved trip, or a pending migration.
  const [localList, setLocalList] = useState<PackingList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");

  // Server lists: my own ("Mi maleta") and the one shared with the people of the trip.
  const activeTrip = useItineraryStore((state) => state.activeTrip);
  const activeTripIsDraft = useItineraryStore((state) => state.activeTripIsDraft);
  const sharedTrips = useItineraryStore((state) => state.sharedTrips);
  const replacePackingList = useItineraryStore((state) => state.replacePackingList);
  const addPackingItem = useItineraryStore((state) => state.addPackingItem);
  const togglePackingItem = useItineraryStore((state) => state.togglePackingItem);
  const assignPackingItem = useItineraryStore((state) => state.assignPackingItem);
  const removePackingItem = useItineraryStore((state) => state.removePackingItem);
  const packing = activeTrip?.id === tripId && !activeTripIsDraft ? activeTrip.packing : undefined;
  const userId = user?.id ?? null;
  const synced = Boolean(packing?.remote && userId);
  const [mode, setMode] = useState<PackingScope>(() => loadPackingMode(tripId));
  const scope: PackingScope = synced ? mode : "personal";
  const role = packing?.role ?? "viewer";
  // My own list is always mine to edit; the shared one belongs to the trip owner and editors.
  const canEdit = !synced || scope === "personal" || role === "owner" || role === "editor";
  const list = useMemo(
    () => (synced && packing ? buildPackingList(tripId, packing.items, scope, userId) : localList),
    [synced, packing, tripId, scope, userId, localList],
  );

  const chooseMode = (next: PackingScope) => {
    setMode(next);
    savePackingMode(tripId, next);
  };

  // People who can bring a shared item. Only the owner can read the share list; an invitee
  // knows the owner and itself.
  const [shares, setShares] = useState<TripShareUser[]>([]);
  const showPeople = synced && scope === "shared" && canEdit;
  useEffect(() => {
    if (!showPeople || role !== "owner") return;
    let cancelled = false;
    void fetchTripShares(tripId).then((result) => {
      if (!cancelled) setShares(result);
    });
    return () => {
      cancelled = true;
    };
  }, [showPeople, role, tripId]);
  const tripOwnerId = activeTrip?.id === tripId ? activeTrip.userId : null;
  const people = useMemo(() => {
    const entries: { id: string; label: string }[] = userId ? [{ id: userId, label: t("packing_person_me") }] : [];
    if (role === "owner") {
      for (const share of shares) entries.push({ id: share.userId, label: share.email });
    } else if (tripOwnerId && tripOwnerId !== userId) {
      const ownerEmail = sharedTrips.find((trip) => trip.id === tripId)?.ownerEmail;
      entries.push({ id: tripOwnerId, label: ownerEmail || t("packing_person_owner") });
    }
    return entries;
  }, [userId, role, shares, tripOwnerId, sharedTrips, tripId, t]);
  const personLabel = (id: string) => people.find((person) => person.id === id)?.label ?? t("packing_person_other");

  // The list needs the trip dates (weather, duration); an undated trip only has placeholders.
  const undated = isTripUndated({ travelContext });
  const hasDates = !undated && days.length > 0 && days[0]?.date && days[days.length - 1]?.date;
  const cities = getUniqueCities(days);

  // Load the device copy on mount (a synced trip moves it to the server on its first load).
  useEffect(() => {
    const saved = loadPackingList(tripId);
    if (saved) setLocalList(saved);
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
    if (!hasDates || !canEdit) return;
    if (!user || user.is_anonymous) {
      onRequireAuth?.();
      return;
    }
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
        headers: await authHeaders(),
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

      if (synced) {
        await replacePackingList(scope, newList);
      } else {
        setLocalList(newList);
        savePackingList(newList);
      }
    } catch {
      setError(t("packing_error"));
    } finally {
      setLoading(false);
    }
  }, [hasDates, canEdit, user, onRequireAuth, fetchWeather, days, cities, travelContext, tripId, lang, t, synced, scope, replacePackingList]);

  const toggleItem = (categoryIndex: number, itemId: string) => {
    if (!list || !canEdit) return;
    if (synced) {
      void togglePackingItem(itemId);
      return;
    }
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
    setLocalList(updated);
    savePackingList(updated);
  };

  const addManualItem = () => {
    if (!list || !newItemName.trim() || !canEdit) return;
    if (synced) {
      void addPackingItem(scope, newItemName);
      setNewItemName("");
      return;
    }
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
    setLocalList(updated);
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
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm sm:p-6">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white">
            <Luggage size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--color-primary)]">
              {t("packing_title")}
            </p>
            <h2 className="mt-1 text-base font-black text-[var(--color-text)]">
              {tripName}
              {list && (
                <span className="ml-2 text-sm font-bold text-[var(--color-primary)]">
                  {t("packing_items_packed", { packed: String(packedItems), total: String(totalItems) })}
                </span>
              )}
            </h2>
          </div>
          <ChevronDown
            size={18}
            className={`mt-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Collapsible body */}
        {open && (
          <div className="mt-4 space-y-4 pl-[52px]">
            {/* Mode: my own list or the one shared with the people of the trip */}
            {synced && (
              <div role="group" aria-label={t("packing_mode_label")} className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-0.5">
                {(["personal", "shared"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={scope === option}
                    onClick={() => chooseMode(option)}
                    className={`min-h-9 rounded-lg px-3 text-xs font-black transition-colors ${
                      scope === option
                        ? "bg-[var(--color-primary)] text-white"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {t(option === "personal" ? "packing_mode_personal" : "packing_mode_shared")}
                  </button>
                ))}
              </div>
            )}

            {synced && !canEdit && (
              <p className="text-xs font-bold text-[var(--color-text-secondary)]">{t("packing_shared_read_only")}</p>
            )}

            {/* No dates hint */}
            {!hasDates && (
              <p className="text-xs font-bold text-[var(--color-text-secondary)]">
                {t(undated ? "packing_no_dates_undated" : "packing_no_dates")}
              </p>
            )}

            {/* Generate / Regenerate button */}
            {hasDates && !list && !loading && canEdit && (
              <button
                type="button"
                onClick={generate}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-xs font-black text-white hover:bg-[var(--color-primary-hover)]"
              >
                <TachiAvatar size={20} />
                {t("packing_generate")}
              </button>
            )}

            {loading && (
              <p className="flex items-center gap-2 text-xs font-bold text-[var(--color-primary)]">
                <TachiAvatar size={20} state="thinking" />
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
                    className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5"
                  >
                    <Thermometer size={12} className="text-[var(--color-primary)]" />
                    <span className="text-[11px] font-bold text-[var(--color-text)]">
                      {w.city}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-secondary)]">
                      {w.tempMinC}–{w.tempMaxC}°C
                    </span>
                    {w.rainProbabilityMax > 30 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-primary)]">
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
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4"
              >
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--color-text-muted)]">
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
                        role="checkbox"
                        aria-checked={item.status === "packed"}
                        aria-label={item.name}
                        disabled={!canEdit}
                        onClick={() => toggleItem(ci, item.id)}
                        className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                          item.status === "packed"
                            ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                            : "border-[var(--color-border-strong)] bg-[var(--color-surface)]"
                        }`}
                      >
                        {item.status === "packed" && <Check size={12} />}
                      </button>
                      <span
                        className={`text-xs font-bold ${
                          item.status === "packed"
                            ? "text-[var(--color-text-muted)] line-through"
                            : "text-[var(--color-text)]"
                        }`}
                      >
                        {item.quantity > 1 && (
                          <span className="mr-1 text-[var(--color-primary)]">
                            {item.quantity}×
                          </span>
                        )}
                        {item.name}
                      </span>
                      {item.reason && (
                        <span className="ml-auto text-[10px] text-[var(--color-text-muted)] hidden sm:inline">
                          {item.reason}
                        </span>
                      )}
                      {showPeople && (
                        <select
                          aria-label={t("packing_assign_for", { item: item.name })}
                          value={item.assignedTo ?? ""}
                          onChange={(e) => void assignPackingItem(item.id, e.target.value || null)}
                          className={`${item.reason ? "" : "ml-auto "}max-w-36 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-text)]`}
                        >
                          <option value="">{t("packing_assigned_nobody")}</option>
                          {people.map((person) => (
                            <option key={person.id} value={person.id}>{person.label}</option>
                          ))}
                          {item.assignedTo && !people.some((person) => person.id === item.assignedTo) && (
                            <option value={item.assignedTo}>{t("packing_person_other")}</option>
                          )}
                        </select>
                      )}
                      {synced && scope === "shared" && !canEdit && item.assignedTo && (
                        <span className={`${item.reason ? "" : "ml-auto "}text-[10px] font-bold text-[var(--color-text-secondary)]`}>
                          {t("packing_assigned_to", { name: personLabel(item.assignedTo) })}
                        </span>
                      )}
                      {synced && canEdit && (
                        <button
                          type="button"
                          aria-label={t("packing_remove_item", { item: item.name })}
                          onClick={() => void removePackingItem(item.id)}
                          className="shrink-0 rounded-md p-0.5 text-[var(--color-text-muted)] hover:text-red-500"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))}

            {/* Manual add */}
            {list && canEdit && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addManualItem()}
                  placeholder={t("packing_add_item_placeholder")}
                  className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-bold text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
                />
                <button
                  type="button"
                  onClick={addManualItem}
                  disabled={!newItemName.trim()}
                  className="flex items-center gap-1 rounded-xl bg-[var(--color-primary)] px-3 py-1.5 text-xs font-black text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
                >
                  <Plus size={12} />
                  {t("packing_add_item")}
                </button>
              </div>
            )}

            {/* Regenerate + generated-at footer */}
            {list && hasDates && canEdit && (
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  {t("packing_generated_at", {
                    date: new Date(list.generatedAt).toLocaleDateString(),
                  })}
                </p>
                <button
                  type="button"
                  onClick={generate}
                  disabled={loading}
                  className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] disabled:opacity-40"
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
