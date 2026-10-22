"use client";

import { useState, type FormEvent } from "react";
import { BusFront, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { compareArrivalOptions, estimateHotelArrival, getHotelArrivalStopsForDay, resolveHotelArrivalStops } from "@/lib/arrival-assistant";
import { getCurrencyFractionDigits, parseTravelContext } from "@/lib/travel-context";
import type { ArrivalOption, ArrivalPriceBasis, ArrivalTransportMode, TravelContext, TripDay } from "@/lib/types";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { HotelCheckInRouteOptions } from "@/components/HotelCheckInRouteOptions";

type OptionDraft = {
  name: string;
  mode: ArrivalTransportMode | "";
  amount: string;
  priceBasis: ArrivalPriceBasis | "";
  vehicleCapacity: string;
  luggageCapacity: string;
  currency: string;
  durationMin: string;
  transfers: string;
  walkingMin: string;
  comfortScore: string;
  source: string;
  sourceCheckedAt: string;
  isEstimate: boolean;
  notes: string;
};

function newDraft(): OptionDraft {
  return {
    name: "",
    mode: "",
    amount: "",
    priceBasis: "",
    vehicleCapacity: "",
    luggageCapacity: "",
    currency: "",
    durationMin: "",
    transfers: "",
    walkingMin: "",
    comfortScore: "",
    source: "",
    sourceCheckedAt: "",
    isEstimate: true,
    notes: "",
  };
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function currencyStep(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency)) return "0.01";
  return String(1 / (10 ** getCurrencyFractionDigits(currency)));
}

function optionPayload(draft: OptionDraft): ArrivalOption | null {
  const amount = Number(draft.amount);
  const durationMin = Number(draft.durationMin);
  const sourceCheckedAt = new Date(draft.sourceCheckedAt);
  if (!draft.mode || !draft.priceBasis || !Number.isFinite(amount) || !Number.isFinite(durationMin) || Number.isNaN(sourceCheckedAt.getTime())) return null;

  const optionalInteger = (value: string) => value === "" ? undefined : Number(value);
  return {
    id: crypto.randomUUID(),
    name: draft.name,
    mode: draft.mode,
    amount,
    priceBasis: draft.priceBasis,
    vehicleCapacity: optionalInteger(draft.vehicleCapacity),
    luggageCapacity: optionalInteger(draft.luggageCapacity),
    currency: draft.currency.toUpperCase(),
    durationMin,
    transfers: optionalInteger(draft.transfers),
    walkingMin: optionalInteger(draft.walkingMin),
    comfortScore: optionalInteger(draft.comfortScore),
    source: draft.source,
    sourceCheckedAt: sourceCheckedAt.toISOString(),
    isEstimate: draft.isEstimate,
    notes: draft.notes,
  };
}

export function ArrivalAssistant({
  context,
  days,
  activeDayId,
  canEdit,
}: {
  context?: TravelContext;
  days: TripDay[];
  activeDayId: string;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const saveTravelContext = useItineraryStore((state) => state.saveTravelContext);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<OptionDraft>(newDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentContext = context;
  const activeDate = days.find((day) => day.id === activeDayId)?.date;
  const allHotelStops = resolveHotelArrivalStops(context, days);
  const hotelStops = getHotelArrivalStopsForDay(allHotelStops, activeDate);
  const primaryStop = hotelStops[0];
  const compareQuotes = allHotelStops.length === 1 && hotelStops.length === 1 && Boolean(context);
  const options = compareQuotes ? currentContext?.arrivalOptions ?? [] : [];
  const comparison = compareArrivalOptions(options, currentContext);
  const recommendation = options.find((option) => option.id === comparison.recommendationId);
  const recommendationResult = comparison.options.find((item) => item.option.id === recommendation?.id);
  const contextWithCheckIn = context && primaryStop?.checkInTime
    ? { ...context, hotel: { ...context.hotel, checkIn: primaryStop.checkInTime } }
    : context;
  const isInitialArrivalStop = primaryStop?.originSource === "trip_arrival" && context?.arrival?.localDate === primaryStop.date;
  const checkInEstimate = recommendation && currentContext && isInitialArrivalStop
    ? estimateHotelArrival(contextWithCheckIn, recommendation)
    : null;

  if (hotelStops.length === 0) return null;
  const luggageCountsComplete = context?.luggage?.carryOnBags !== undefined && context.luggage.checkedBags !== undefined;
  const knownBagCount = luggageCountsComplete ? context.luggage!.carryOnBags! + context.luggage!.checkedBags! : 0;

  const updateDraft = <K extends keyof OptionDraft>(key: K, value: OptionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const persistOptions = async (nextOptions: ArrivalOption[]) => {
    const next = parseTravelContext({ ...currentContext, version: 1, arrivalOptions: nextOptions });
    if (!next) {
      setError(t("arrival_option_invalid"));
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveTravelContext(next);
      if (result.error) {
        setError(t(result.error === "conflict" ? "trip_context_conflict" : "arrival_option_save_failed"));
        return false;
      }
      return true;
    } catch {
      setError(t("arrival_option_save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addOption = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const option = optionPayload(draft);
    if (!option || options.length >= 12) {
      setError(t("arrival_option_invalid"));
      return;
    }
    if (await persistOptions([...options, option])) setDraft(newDraft());
  };

  const removeOption = async (optionId: string) => {
    await persistOptions(options.filter((option) => option.id !== optionId));
  };

  return (
    <section className="mx-auto mt-5 w-full max-w-7xl px-5">
      <div className="overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white shadow-sm dark:border-sky-900/60 dark:from-sky-950/40 dark:to-stone-950">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-lg shadow-sky-600/20">
              <BusFront size={21} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">{t("arrival_to_hotel")}</p>
              <p className="mt-1 truncate text-sm font-bold text-stone-800 dark:text-stone-100">
                {t("arrival_checkin_stops_count", { count: hotelStops.length })}
              </p>
              {recommendation && recommendationResult && primaryStop ? (
                <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
                  {t("arrival_recommended", {
                    name: `${primaryStop.destination}: ${recommendation.name}`,
                    total: formatMoney(recommendationResult.totalGroupCost ?? 0, recommendation.currency),
                  })}
                </p>
              ) : (
                <p className="mt-1 text-xs text-stone-500">
                  {options.length > 0 ? t("arrival_options_count", { count: options.length }) : t("arrival_default_modes_hint")}
                </p>
              )}
            </div>
          </div>
          {canEdit && compareQuotes ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setOpen((value) => !value);
              }}
              className="rounded-xl bg-sky-700 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-sky-800"
            >
              {open ? t("close_arrival_options") : t("compare_arrival_options")}
            </button>
          ) : null}
        </div>

        <div className="space-y-3 px-5 pb-5 sm:px-6">
          {hotelStops.map((stop) => <HotelCheckInRouteOptions key={stop.id} stop={stop} isCurrentDay={stop.date === activeDate} />)}
        </div>

        {open && canEdit && compareQuotes ? (
          <div className="border-t border-sky-100 px-5 py-5 dark:border-sky-900/60 sm:px-6">
            {options.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {comparison.options.map(({ option, totalGroupCost, vehiclesRequired, score }) => {
                  const isRecommended = option.id === comparison.recommendationId;
                  const hotelArrival = estimateHotelArrival(contextWithCheckIn, option);
                  const needsVehicleDetails = option.priceBasis === "per_vehicle" && (
                    !luggageCountsComplete || (knownBagCount > 0 && !option.luggageCapacity)
                  );
                  return (
                    <article key={option.id} className={`rounded-2xl border p-4 ${isRecommended ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/70"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-black text-stone-800 dark:text-white">{option.name}</h3>
                            {isRecommended ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase text-white">{t("arrival_recommended_badge")}</span> : null}
                            {option.isEstimate ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t("arrival_estimated_badge")}</span> : null}
                            {!option.isEstimate ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9px] font-black uppercase text-stone-600 dark:bg-stone-800 dark:text-stone-300">{t("arrival_confirmed_badge")}</span> : null}
                          </div>
                          <p className="mt-1 text-xs text-stone-500">{t(`arrival_mode_${option.mode}`)}</p>
                        </div>
                        {canEdit ? (
                          <button type="button" onClick={() => void removeOption(option.id)} disabled={saving} aria-label={t("remove_arrival_option")} className="rounded-lg p-2 text-stone-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/40">
                            <Trash2 size={15} />
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
                        <div>
                          <span className="block text-stone-400">{t("arrival_group_total")}</span>
                          <strong className="mt-0.5 block text-stone-800 dark:text-stone-100">
                            {totalGroupCost !== null
                              ? formatMoney(totalGroupCost, option.currency)
                              : needsVehicleDetails
                                ? t("arrival_vehicle_details_required")
                                : t("arrival_traveler_count_required_short")}
                          </strong>
                          {vehiclesRequired ? <span className="mt-0.5 block text-[10px] text-stone-500">{t("arrival_vehicles_required", { count: vehiclesRequired })}</span> : null}
                        </div>
                        <div><span className="block text-stone-400">{t("arrival_per_person")}</span><strong className="mt-0.5 block text-stone-800 dark:text-stone-100">{totalGroupCost === null || !context?.travelerCount ? t("arrival_not_provided") : formatMoney(totalGroupCost / context.travelerCount, option.currency)}</strong></div>
                        <div><span className="block text-stone-400">{t("arrival_duration")}</span><strong className="mt-0.5 block text-stone-800 dark:text-stone-100">{t("arrival_minutes_value", { count: option.durationMin })}</strong></div>
                        <div><span className="block text-stone-400">{t("arrival_walking")}</span><strong className="mt-0.5 block text-stone-800 dark:text-stone-100">{option.walkingMin === undefined ? t("arrival_not_provided") : t("arrival_minutes_value", { count: option.walkingMin })}</strong></div>
                        <div><span className="block text-stone-400">{t("arrival_transfers")}</span><strong className="mt-0.5 block text-stone-800 dark:text-stone-100">{option.transfers ?? t("arrival_not_provided")}</strong></div>
                      </div>
                      <p className="mt-3 text-[11px] text-stone-500">
                        {t("arrival_source_checked", { source: option.source, date: formatCheckedAt(option.sourceCheckedAt) })}
                      </p>
                      {option.notes ? <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">{option.notes}</p> : null}
                      {isRecommended && score !== null ? <p className="mt-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">{t("arrival_score", { score: Math.round(score) })}</p> : null}
                      {hotelArrival ? (
                        <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs text-stone-700 dark:bg-stone-950/60 dark:text-stone-300">
                          {t(`checkin_${hotelArrival.relationToCheckIn}`, {
                            time: hotelArrival.arrivalTime,
                            checkIn: hotelArrival.checkInTime,
                            minutes: hotelArrival.differenceMin,
                          })}
                          <span className="ml-1 text-stone-400">({hotelArrival.timeZone})</span>
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-2xl bg-white/70 p-4 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">{t("arrival_no_options")}</p>
            )}

            {comparison.unavailableReason ? (
              <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">{t(`arrival_compare_blocked_${comparison.unavailableReason}`)}</p>
            ) : comparison.reason ? (
              <p className="mt-3 rounded-2xl bg-white/70 p-4 text-sm leading-relaxed text-stone-700 dark:bg-stone-900 dark:text-stone-200">
                <strong className="mr-1">{t("why_recommended")}</strong>
                {comparison.reason.recommendedTotal === comparison.reason.cheapestTotal
                  ? t("arrival_reason_lowest_cost", {
                      criteria: comparison.reason.criteria.map((criterion) => t(`arrival_criterion_${criterion}`)).join(", "),
                    })
                  : t("arrival_reason", {
                      extra: formatMoney(comparison.reason.recommendedTotal - comparison.reason.cheapestTotal, recommendation?.currency ?? "EUR"),
                      timeTradeoff: comparison.reason.recommendedDurationMin < comparison.reason.cheapestDurationMin
                        ? t("arrival_saves_minutes", { count: comparison.reason.cheapestDurationMin - comparison.reason.recommendedDurationMin })
                        : comparison.reason.recommendedDurationMin > comparison.reason.cheapestDurationMin
                          ? t("arrival_takes_longer", { count: comparison.reason.recommendedDurationMin - comparison.reason.cheapestDurationMin })
                          : t("arrival_same_time"),
                      criteria: comparison.reason.criteria.map((criterion) => t(`arrival_criterion_${criterion}`)).join(", "),
                    })}
              </p>
            ) : null}

            {recommendation && !checkInEstimate && primaryStop?.checkInTime ? (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{t("arrival_checkin_unavailable")}</p>
            ) : null}
            {recommendation && !primaryStop?.checkInTime ? (
              <p className="mt-3 text-xs text-stone-500">{t("arrival_checkin_missing")}</p>
            ) : null}

            {error ? <p role="alert" className="mt-3 text-xs font-bold text-rose-600">{error}</p> : null}

            {canEdit ? (
              <details className="mt-5 rounded-2xl border border-dashed border-sky-300 bg-white/60 p-4 dark:border-sky-800 dark:bg-stone-950/40">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-black text-sky-800 dark:text-sky-300">
                  <Plus size={16} /> {t("add_arrival_option")}
                </summary>
                <form onSubmit={addOption} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-3">
                    {t("option_name")}
                    <input required maxLength={120} value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("transport_mode")}
                    <select required value={draft.mode} onChange={(event) => updateDraft("mode", event.target.value as ArrivalTransportMode | "")} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900">
                      <option value="">{t("arrival_select_option")}</option>
                      <option value="public_transport">{t("arrival_mode_public_transport")}</option>
                      <option value="taxi">{t("arrival_mode_taxi")}</option>
                      <option value="ride_hailing">{t("arrival_mode_ride_hailing")}</option>
                      <option value="private_transfer">{t("arrival_mode_private_transfer")}</option>
                      <option value="other">{t("arrival_mode_other")}</option>
                    </select>
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("quoted_amount")}
                    <input required type="number" min="0" max="1000000" step={currencyStep(draft.currency)} value={draft.amount} onChange={(event) => updateDraft("amount", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("arrival_currency")}
                    <input required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" placeholder="EUR" value={draft.currency} onChange={(event) => updateDraft("currency", event.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm uppercase dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-1">
                    {t("price_basis")}
                    <select required value={draft.priceBasis} onChange={(event) => updateDraft("priceBasis", event.target.value as ArrivalPriceBasis | "")} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900">
                      <option value="">{t("arrival_select_option")}</option>
                      <option value="per_person">{t("per_person")}</option>
                      <option value="whole_group">{t("whole_group")}</option>
                      <option value="per_vehicle">{t("per_vehicle")}</option>
                    </select>
                  </label>
                  {draft.priceBasis === "per_vehicle" && !luggageCountsComplete ? (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300 sm:col-span-2 lg:col-span-3">{t("arrival_enter_luggage_first")}</p>
                  ) : null}
                  {draft.priceBasis === "per_vehicle" ? (
                    <>
                      <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                        {t("vehicle_seat_capacity")}
                        <input required type="number" min="1" max="50" step="1" value={draft.vehicleCapacity} onChange={(event) => updateDraft("vehicleCapacity", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                      </label>
                      <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                        {t("vehicle_luggage_capacity")}
                        <input required={luggageCountsComplete && knownBagCount > 0} type="number" min="1" max="100" step="1" value={draft.luggageCapacity} onChange={(event) => updateDraft("luggageCapacity", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                      </label>
                    </>
                  ) : null}
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("duration_minutes")}
                    <input required type="number" min="1" max="1440" step="1" value={draft.durationMin} onChange={(event) => updateDraft("durationMin", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("transfer_count_optional")}
                    <input type="number" min="0" max="30" step="1" value={draft.transfers} onChange={(event) => updateDraft("transfers", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("walking_minutes_optional")}
                    <input type="number" min="0" max="1440" step="1" value={draft.walkingMin} onChange={(event) => updateDraft("walkingMin", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("comfort_score_optional")}
                    <select value={draft.comfortScore} onChange={(event) => updateDraft("comfortScore", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900">
                      <option value="">{t("not_provided")}</option>
                      {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}/5</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-3">
                    {t("arrival_source")}
                    <input required maxLength={240} placeholder={t("arrival_source_placeholder")} value={draft.source} onChange={(event) => updateDraft("source", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300">
                    {t("source_checked_at")}
                    <input required type="datetime-local" value={draft.sourceCheckedAt} onChange={(event) => updateDraft("sourceCheckedAt", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-stone-600 dark:text-stone-300">
                    <input type="checkbox" checked={draft.isEstimate} onChange={(event) => updateDraft("isEstimate", event.target.checked)} />
                    {t("this_is_estimate")}
                  </label>
                  <label className="text-xs font-bold text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-3">
                    {t("arrival_notes_optional")}
                    <textarea maxLength={500} rows={2} value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900" />
                  </label>
                  <div className="flex items-center justify-between gap-3 sm:col-span-2 lg:col-span-3">
                    <p className="text-[11px] text-stone-500">{t("group_quote_help", { travelers: context?.travelerCount ?? "?" })}</p>
                    <button type="submit" disabled={saving || options.length >= 12} className="flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-xs font-black uppercase text-white disabled:opacity-50">
                      {saving ? <LoaderCircle size={14} className="animate-spin" /> : null}
                      {t("save_arrival_option")}
                    </button>
                  </div>
                </form>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
