"use client";

import { useState, type FormEvent } from "react";
import { Compass, LoaderCircle, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { parseTravelContext } from "@/lib/travel-context";
import type { TravelContext } from "@/lib/types";
import { useItineraryStore } from "@/store/use-itinerary-store";

type Section = "luggage" | "arrival" | "hotel" | "preferences";

function setTravelerCount(current: TravelContext, value: number | undefined) {
  const next = { ...current };
  if (value === undefined) delete next.travelerCount;
  else next.travelerCount = value;
  return next;
}

function setSectionValue(
  current: TravelContext,
  section: Section,
  field: string,
  value: string | number | boolean | undefined
): TravelContext {
  const previous = current[section] as Record<string, unknown> | undefined;
  const values = { ...previous };
  if (value === undefined || value === "") delete values[field];
  else values[field] = value;

  const next = { ...current } as unknown as Record<string, unknown>;
  if (Object.keys(values).length > 0) next[section] = values;
  else delete next[section];
  return next as unknown as TravelContext;
}

export function TravelContextEditor({
  context,
  canEdit,
}: {
  context?: TravelContext;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const saveTravelContext = useItineraryStore((state) => state.saveTravelContext);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TravelContext>(context ?? { version: 1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (section: Section, field: string, value: string | number | boolean | undefined) => {
    setForm((current) => setSectionValue(current, section, field, value));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hasDetails = Object.keys(form).some((key) => key !== "version");
    const normalized = parseTravelContext(form);
    if (hasDetails && !normalized) {
      setError(t("trip_context_invalid"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await saveTravelContext(normalized);
      if (result.error) {
        setError(t(result.error === "conflict" ? "trip_context_conflict" : "trip_context_save_failed"));
        return;
      }
      setForm(normalized ?? { version: 1 });
      setOpen(false);
    } catch {
      setError(t("trip_context_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm(context ?? { version: 1 });
          setError(null);
          setOpen(true);
        }}
        aria-label={t("trip_context")}
        title={t("trip_context")}
        className="fixed bottom-8 right-52 z-50 flex size-14 items-center justify-center rounded-2xl border border-white/20 bg-[var(--color-text-secondary)] text-white shadow-xl transition hover:bg-[var(--color-text)]"
      >
        <Compass size={22} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[var(--color-text)]/60 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="travel-context-title"
            className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-[var(--color-surface)] shadow-2xl sm:rounded-3xl"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 sm:px-7">
              <div>
                <h2 id="travel-context-title" className="text-lg font-black text-[var(--color-text)]">
                  {t("trip_context")}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t("trip_context_hint")}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("trip_context_sharing_note")}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close_trip_context")}
                className="flex size-9 items-center justify-center rounded-full bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]"
              >
                <X size={18} />
              </button>
            </header>

            <form onSubmit={save} className="space-y-6 overflow-y-auto px-5 py-5 sm:px-7">
              <fieldset disabled={!canEdit} className="space-y-6 disabled:opacity-80">
                <section className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-primary)]">{t("travelers_and_luggage")}</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {t("traveler_count")}
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={form.travelerCount ?? ""}
                        onChange={(event) => setForm((current) => setTravelerCount(
                          current,
                          event.target.value ? Number(event.target.value) : undefined,
                        ))}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {t("carry_on_bags")}
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={form.luggage?.carryOnBags ?? ""}
                        onChange={(event) => update("luggage", "carryOnBags", event.target.value ? Number(event.target.value) : undefined)}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {t("checked_bags")}
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={form.luggage?.checkedBags ?? ""}
                        onChange={(event) => update("luggage", "checkedBags", event.target.value ? Number(event.target.value) : undefined)}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-primary)]">{t("arrival_details")}</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold text-[var(--color-text-secondary)] sm:col-span-2">
                      {t("arrival_location")}
                      <input
                        value={form.arrival?.location ?? ""}
                        onChange={(event) => update("arrival", "location", event.target.value || undefined)}
                        placeholder={t("arrival_location_placeholder")}
                        maxLength={240}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {t("arrival_date")}
                      <input
                        type="date"
                        value={form.arrival?.localDate ?? ""}
                        onChange={(event) => update("arrival", "localDate", event.target.value || undefined)}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {t("arrival_time")}
                      <input
                        type="time"
                        value={form.arrival?.localTime ?? ""}
                        onChange={(event) => update("arrival", "localTime", event.target.value || undefined)}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)] sm:col-span-2">
                      {t("time_zone")}
                      <input
                        value={form.arrival?.timeZone ?? ""}
                        onChange={(event) => update("arrival", "timeZone", event.target.value || undefined)}
                        placeholder="Europe/Paris"
                        maxLength={64}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-primary)]">{t("accommodation")}</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold text-[var(--color-text-secondary)] sm:col-span-2">
                      {t("hotel_name")}
                      <input
                        value={form.hotel?.name ?? ""}
                        onChange={(event) => update("hotel", "name", event.target.value || undefined)}
                        maxLength={160}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)] sm:col-span-2">
                      {t("hotel_address")}
                      <input
                        value={form.hotel?.address ?? ""}
                        onChange={(event) => update("hotel", "address", event.target.value || undefined)}
                        maxLength={300}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {t("check_in")}
                      <input
                        type="time"
                        value={form.hotel?.checkIn ?? ""}
                        onChange={(event) => update("hotel", "checkIn", event.target.value || undefined)}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label className="text-xs font-bold text-[var(--color-text-secondary)]">
                      {t("check_out")}
                      <input
                        type="time"
                        value={form.hotel?.checkOut ?? ""}
                        onChange={(event) => update("hotel", "checkOut", event.target.value || undefined)}
                        className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-[var(--color-primary)]">{t("preferences")}</h3>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={form.shareWithAI ?? false}
                        onChange={(event) => setForm((current) => ({ ...current, shareWithAI: event.target.checked }))}
                      />
                      {t("allow_ai_context")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={form.preferences?.minimizeWalking ?? false}
                        onChange={(event) => update("preferences", "minimizeWalking", event.target.checked)}
                      />
                      {t("minimize_walking")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={form.preferences?.avoidTransfers ?? false}
                        onChange={(event) => update("preferences", "avoidTransfers", event.target.checked)}
                      />
                      {t("avoid_transfers")}
                    </label>
                  </div>
                  <label className="block max-w-xs text-xs font-bold text-[var(--color-text-secondary)]">
                    {t("budget_level")}
                    <select
                      value={form.preferences?.budgetLevel ?? ""}
                      onChange={(event) => update("preferences", "budgetLevel", event.target.value || undefined)}
                      className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm"
                    >
                      <option value="">{t("not_set")}</option>
                      <option value="low">{t("budget_low")}</option>
                      <option value="medium">{t("budget_medium")}</option>
                      <option value="high">{t("budget_high")}</option>
                    </select>
                  </label>
                </section>
              </fieldset>

              {error ? <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">{error}</p> : null}

              <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ version: 1 });
                      setError(null);
                    }}
                    className="mr-auto rounded-xl px-3 py-2.5 text-xs font-bold text-[var(--color-danger)]"
                  >
                    {t("clear_context_fields")}
                  </button>
                ) : null}
                <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--color-text-muted)]">
                  {t("cancel")}
                </button>
                {canEdit ? (
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {saving ? <LoaderCircle size={16} className="animate-spin" /> : null}
                    {t("save")}
                  </button>
                ) : null}
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
