"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Edit2, Loader2, MapPin, Mic, ShoppingBag, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { authHeaders } from "@/lib/auth-headers";
import { haversineKm } from "@/lib/day-genius/context";
import { findNearbyForItems, nearbyAlerts, type NearbyAlert, type NearbyMatch } from "@/lib/shopping/nearby";
import type { ShoppingAssistantResponse, ShoppingCandidatePlace, ShoppingItem } from "@/lib/types";
import { useItineraryStore } from "@/store/use-itinerary-store";

const EMPTY_ITEMS: ShoppingItem[] = [];
/** Moving less than this does not trigger a new nearby search. */
const RESEARCH_DISTANCE_M = 200;

type Position = { lat: number; lon: number };

const metersBetween = (a: Position, b: Position) => haversineKm({ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon }) * 1000;

const mapsUrl = (place: NearbyMatch) => `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;

export function ShoppingListPanel({
  today,
  selectedItemId,
  onSelectItem,
  onToast,
  onBought,
  onNearbyPlaces,
}: {
  /** Trip-local date: nearby notices are shown once per item and place per day. */
  today: string;
  selectedItemId: string | null;
  onSelectItem: (itemId: string | null) => void;
  onToast: (msg: string, type?: "success" | "error") => void;
  onBought: (itemName: string) => void;
  onNearbyPlaces: (places: ShoppingCandidatePlace[]) => void;
}) {
  const { t, lang } = useI18n();
  const items = useItineraryStore((s) => s.activeTrip?.shoppingItems ?? EMPTY_ITEMS);
  const addShoppingItems = useItineraryStore((s) => s.addShoppingItems);
  const toggleShoppingItemStatus = useItineraryStore((s) => s.toggleShoppingItemStatus);
  const updateShoppingItem = useItineraryStore((s) => s.updateShoppingItem);
  const removeShoppingItem = useItineraryStore((s) => s.removeShoppingItem);

  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [locating, setLocating] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [matches, setMatches] = useState<Record<string, NearbyMatch[]>>({});
  const [attribution, setAttribution] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<NearbyAlert[]>([]);
  const watchRef = useRef<number | null>(null);
  const lastSearchRef = useRef<Position | null>(null);
  const seenAlertsRef = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const parentRef = useRef({ onToast, onNearbyPlaces });
  parentRef.current = { onToast, onNearbyPlaces };

  const sorted = useMemo(
    () => [...items.filter((i) => i.status === "pending"), ...items.filter((i) => i.status !== "pending")],
    [items],
  );
  const pendingKey = items.filter((i) => i.status === "pending").map((i) => i.id).join(",");

  const addFromText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      const response = await fetch("/api/shopping-assistant", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ type: "wishlist_input", text: trimmed, lang, shopping_list: itemsRef.current }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const result = (await response.json()) as ShoppingAssistantResponse;
      if (result.wishlist_items.length === 0) {
        onToast(t("trip_view_shopping_nothing_new"), "error");
        return;
      }
      await addShoppingItems(result.wishlist_items);
      setInput("");
      onToast(t("shopping_added", { items: result.wishlist_items.map((i) => i.name).join(", ") }));
    } catch (error) {
      console.error("Shopping assistant failed", error);
      onToast(t("trip_view_shopping_assistant_failed"), "error");
    } finally {
      setAdding(false);
    }
  };

  const voice = useVoiceDictation({
    lang,
    onText: setInput,
    onSubmit: (text) => void addFromText(text),
    onDenied: () => onToast(t("shopping_mic_denied"), "error"),
  });

  const toggleBought = async (item: ShoppingItem) => {
    await toggleShoppingItemStatus(item.id);
    if (item.status === "pending") onBought(item.name);
  };

  const saveEdit = async (item: ShoppingItem) => {
    const name = draft.trim();
    setEditingId(null);
    if (name && name !== item.name) await updateShoppingItem(item.id, { name });
  };

  // A new search when the traveler moved enough or the pending items changed.
  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    void findNearbyForItems(itemsRef.current, position)
      .then((result) => {
        if (cancelled) return;
        setMatches(result.matches);
        setAttribution(result.attribution);
        parentRef.current.onNearbyPlaces(result.places.map((p) => ({ name: p.name, area: p.area })));
        const fresh = nearbyAlerts({ items: itemsRef.current, matches: result.matches, date: today, seen: seenAlertsRef.current });
        if (fresh.length > 0) setAlerts((current) => [...fresh, ...current]);
      })
      .catch(() => {
        if (!cancelled) parentRef.current.onToast(t("trip_view_nearby_places_failed"), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [pendingKey, position, t, today]);

  useEffect(() => () => {
    if (watchRef.current !== null) navigator.geolocation?.clearWatch(watchRef.current);
  }, []);

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      onToast(t("map_location_not_supported"), "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        lastSearchRef.current = here;
        setPosition(here);
        if (watchRef.current === null) {
          onToast(t("shopping_tracking_on"));
          // While the app is open, follow the traveler to warn when a shop is close.
          watchRef.current = navigator.geolocation.watchPosition(
            (next) => {
              const moved = { lat: next.coords.latitude, lon: next.coords.longitude };
              if (lastSearchRef.current && metersBetween(lastSearchRef.current, moved) < RESEARCH_DISTANCE_M) return;
              lastSearchRef.current = moved;
              setPosition(moved);
            },
            () => undefined,
            { enableHighAccuracy: false, maximumAge: 60_000 },
          );
        }
      },
      (error) => {
        setLocating(false);
        onToast(t(error.code === 1 ? "shopping_location_denied" : "trip_view_nearby_places_failed"), "error");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const categoryLabel = (item: ShoppingItem) => (item.category && item.category !== "other" ? t(`shopping_category_${item.category}`) : null);

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("trip_view_shopping_list")}</h3>
        <span className="rounded-full bg-[var(--color-surface-subtle)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--color-text-muted)]">{sorted.length}</span>
      </div>

      {alerts.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {alerts.map((alert) => (
            <li key={alert.key} className="flex items-start gap-2 rounded-xl bg-[var(--color-primary-subtle)] p-3 text-xs text-[var(--color-primary)]">
              <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <a href={mapsUrl(alert.place)} target="_blank" rel="noopener noreferrer" className="flex-1 font-semibold">
                {t("shopping_alert", { distance: alert.place.distanceM, place: alert.place.name, item: alert.itemName })}
              </a>
              <button
                type="button"
                onClick={() => setAlerts((current) => current.filter((a) => a.key !== alert.key))}
                aria-label={t("shopping_alert_dismiss")}
                className="shrink-0 opacity-70 hover:opacity-100"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          voice.cancel();
          void addFromText(input);
        }}
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                voice.textEdited();
              }}
              placeholder={t("trip_view_shopping_input_placeholder")}
              aria-label={t("trip_view_shopping_input_placeholder")}
              className={`w-full rounded-xl border bg-[var(--color-surface-subtle)] py-2.5 pl-3 pr-10 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[var(--color-primary)]/20 ${
                voice.state === "listening" ? "border-[var(--color-danger)] ring-4 ring-[var(--color-danger)]/10" : "border-[var(--color-border)]"
              }`}
            />
            {voice.supported && voice.state !== "preview" && (
              <button
                type="button"
                onClick={voice.state === "listening" ? voice.cancel : voice.start}
                aria-label={t(voice.state === "listening" ? "shopping_mic_stop" : "shopping_mic_start")}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 transition-all ${
                  voice.state === "listening"
                    ? "animate-pulse bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)]"
                }`}
              >
                <Mic size={16} />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={adding || !input.trim()}
            className="rounded-xl bg-[var(--color-primary)] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50"
          >
            {adding ? <Loader2 size={14} className="animate-spin" aria-label={t("trip_view_add")} /> : t("trip_view_add")}
          </button>
        </div>
        {voice.state === "preview" && (
          <div className="flex items-center gap-2 text-[11px] font-bold text-[var(--color-text-secondary)]">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            <span>{t("shopping_add_in", { seconds: voice.countdown })}</span>
            <button type="button" onClick={voice.cancel} className="rounded-full px-2 py-0.5 underline">
              {t("edit_manually")}
            </button>
          </div>
        )}
      </form>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-primary)]/30 hover:text-[var(--color-primary)] disabled:opacity-50"
        >
          <MapPin size={12} aria-hidden="true" />
          {locating ? t("map_locating") : position ? t("trip_view_refresh_nearby") : t("map_use_my_location")}
        </button>
        {attribution && <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">{attribution}</span>}
      </div>

      <ul className="space-y-2">
        {sorted.length === 0 && (
          <li className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-border)] px-4 py-6 text-[var(--color-text-muted)]">
            <ShoppingBag size={24} aria-hidden="true" />
            <span className="text-[11px] font-bold uppercase tracking-widest">{t("no_shopping_items_yet")}</span>
          </li>
        )}

        {sorted.map((item) => {
          const isSelected = selectedItemId === item.id;
          const bought = item.status === "purchased";
          const label = categoryLabel(item);
          const nearby = bought ? [] : matches[item.id] ?? [];
          return (
            <li
              key={item.id}
              className={`rounded-xl border px-3 py-2.5 transition-all ${
                isSelected ? "border-[var(--color-primary)]/30 bg-[var(--color-primary-subtle)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={bought}
                  onChange={() => void toggleBought(item)}
                  aria-label={item.name}
                  className="mt-1 size-4 rounded border-[var(--color-border-strong)] accent-[var(--color-primary)]"
                />
                {editingId === item.id ? (
                  <form
                    className="flex flex-1 items-center gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdit(item);
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      aria-label={t("trip_view_edit_shopping_item")}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                    />
                    <button type="submit" aria-label={t("shopping_edit_save")} className="text-[var(--color-primary)]">
                      <Check size={15} />
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} aria-label={t("shopping_edit_cancel")} className="text-[var(--color-text-muted)]">
                      <X size={15} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button type="button" onClick={() => onSelectItem(isSelected ? null : item.id)} className="flex-1 text-left">
                      <span className={`block text-sm font-bold ${bought ? "text-[var(--color-text-muted)] line-through" : "text-[var(--color-text)]"}`}>{item.name}</span>
                      {(label || item.preferred_cities?.length) && (
                        <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">
                          {[label, item.preferred_cities?.length ? t("trip_view_best_in", { cities: item.preferred_cities.join(", ") }) : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(item.name);
                          setEditingId(item.id);
                        }}
                        aria-label={t("shopping_edit", { item: item.name })}
                        className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)]"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeShoppingItem(item.id)}
                        aria-label={t("shopping_delete", { item: item.name })}
                        className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </>
                )}
              </div>
              {nearby.length > 0 && (
                <ul className="ml-7 mt-1.5 space-y-0.5">
                  {nearby.map((place) => (
                    <li key={`${place.name}|${place.lat}|${place.lon}`}>
                      <a
                        href={mapsUrl(place)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--color-primary)] hover:underline"
                      >
                        <MapPin size={11} aria-hidden="true" />
                        {t("shopping_nearby_at", { place: place.name, distance: place.distanceM })}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
