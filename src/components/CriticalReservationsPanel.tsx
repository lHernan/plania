"use client";

import { useEffect, useId, useState } from "react";
import { CalendarDays, ExternalLink, Plus, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";
import { useI18n } from "@/components/I18nProvider";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { getCurrentDateString } from "@/lib/trip-selection";
import type { CriticalReservation } from "@/lib/types";
import { useItineraryStore } from "@/store/use-itinerary-store";

const EMPTY: CriticalReservation[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;
/** From this many days before the deadline the reservation is flagged as close. */
const SOON_DAYS = 3;

type Draft = Pick<CriticalReservation, "title" | "reservationDate" | "bookingDeadline" | "bookingLink" | "price">;

const daysUntil = (date: string, today: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

/** The trip's "book before" list: what has a deadline, how close it is, and checking it off. */
export function CriticalReservationsPanel({
  canEdit,
  onBooked,
}: {
  /** False for people the trip was shared with: they see the list but cannot change it. */
  canEdit: boolean;
  /** A reservation was just checked as booked (for the Tachao toast). */
  onBooked: (title: string) => void;
}) {
  const { t, lang } = useI18n();
  const reservations = useItineraryStore((s) => s.activeTrip?.criticalReservations ?? EMPTY);
  const toggleBooking = useItineraryStore((s) => s.toggleBooking);
  const addReservation = useItineraryStore((s) => s.addReservation);
  const patchReservation = useItineraryStore((s) => s.patchReservation);
  const removeReservation = useItineraryStore((s) => s.removeReservation);
  const [editing, setEditing] = useState<CriticalReservation | "new" | null>(null);
  const today = getCurrentDateString();

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  const deadlineChip = (reservation: CriticalReservation) => {
    if (reservation.status === "booked") return { text: t("reservation_booked"), tone: "done" as const };
    if (!reservation.bookingDeadline) return null;
    const days = daysUntil(reservation.bookingDeadline, today);
    if (days < 0) return { text: t("reservation_deadline_passed"), tone: "late" as const };
    if (days === 0) return { text: t("reservation_deadline_today"), tone: "late" as const };
    if (days <= SOON_DAYS) return { text: t(days === 1 ? "reservation_deadline_one_day" : "reservation_deadline_days", { days }), tone: "soon" as const };
    return { text: t("reservation_deadline_on", { date: formatDate(reservation.bookingDeadline) }), tone: "calm" as const };
  };

  const toggle = async (reservation: CriticalReservation) => {
    await toggleBooking(reservation.id);
    if (reservation.status !== "booked") onBooked(reservation.title);
  };

  // Pending first, closest deadline first; booked ones at the end.
  const sorted = [...reservations].sort((a, b) =>
    (a.status === "booked" ? 1 : 0) - (b.status === "booked" ? 1 : 0) || (a.bookingDeadline || "9999").localeCompare(b.bookingDeadline || "9999"),
  );

  return (
    <div data-tour="reservations" className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("critical_reservations")}</h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            aria-label={t("reservation_new")}
            title={t("reservation_new")}
            className="flex size-7 items-center justify-center rounded-lg bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)]"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-border)] px-4 py-6 text-[var(--color-text-muted)]">
          <CalendarDays size={24} aria-hidden="true" />
          <span className="text-center text-xs font-medium">{t("no_reservations_yet")}</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((reservation) => {
            const booked = reservation.status === "booked";
            const chip = deadlineChip(reservation);
            return (
              <li
                key={reservation.id}
                aria-label={reservation.title}
                className={`rounded-xl border px-3 py-2.5 transition-all ${
                  chip?.tone === "late" ? "border-[var(--color-danger)]/40" : chip?.tone === "soon" ? "border-[var(--color-warning)]/40" : "border-[var(--color-border)]"
                } bg-[var(--color-surface)]`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={booked}
                    onChange={() => void toggle(reservation)}
                    disabled={!canEdit}
                    aria-label={reservation.title}
                    className="mt-1 size-4 rounded border-[var(--color-border-strong)] accent-[var(--color-primary)]"
                  />
                  <button
                    type="button"
                    onClick={() => canEdit && setEditing(reservation)}
                    disabled={!canEdit}
                    aria-label={canEdit ? t("reservation_edit_item", { title: reservation.title }) : undefined}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <span className={`block text-sm font-bold ${booked ? "text-[var(--color-text-muted)] line-through" : "text-[var(--color-text)]"}`}>
                      {reservation.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">
                      {[
                        reservation.reservationDate ? t("reservation_for_date", { date: formatDate(reservation.reservationDate) }) : null,
                        reservation.price ? t("reservation_price", { price: reservation.price }) : null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                    {chip && (
                      <span
                        className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          chip.tone === "done"
                            ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                            : chip.tone === "late"
                              ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                              : chip.tone === "soon"
                                ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
                                : "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]"
                        }`}
                      >
                        {chip.text}
                      </span>
                    )}
                  </button>
                  {reservation.bookingLink && (
                    <a
                      href={reservation.bookingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("reservation_open_link", { title: reservation.title })}
                      className="mt-0.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)]"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <ReservationModal
          reservation={editing === "new" ? null : editing}
          today={today}
          onClose={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing === "new") await addReservation({ ...draft, urgency: "safe", status: "pending" });
            else await patchReservation(editing.id, draft);
            setEditing(null);
          }}
          onDelete={async () => {
            if (editing !== "new") await removeReservation(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ReservationModal({
  reservation,
  today,
  onClose,
  onSave,
  onDelete,
}: {
  reservation: CriticalReservation | null;
  today: string;
  onClose: () => void;
  onSave: (draft: Draft) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const fieldId = useId();
  const { confirm, dialog } = useConfirmDialog();
  const [draft, setDraft] = useState<Draft>({
    title: reservation?.title ?? "",
    reservationDate: reservation?.reservationDate ?? today,
    bookingDeadline: reservation?.bookingDeadline ?? today,
    bookingLink: reservation?.bookingLink ?? "",
    price: reservation?.price,
  });
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const input = "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm font-medium text-[var(--color-text)] outline-none transition-all focus:ring-2 focus:ring-[var(--color-primary)]/20";
  const label = "mb-1.5 block text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)]";
  const heading = t(reservation ? "reservation_edit" : "reservation_new");

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-6" onClick={onClose}>
      {dialog}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm" aria-hidden="true" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-2xl md:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4 md:px-8">
          <h2 id={titleId} className="text-xl font-black text-[var(--color-text)]">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("reservation_close")}
            className="flex size-9 items-center justify-center rounded-full bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]"
          >
            <X size={18} />
          </button>
        </header>

        <form
          id={`${fieldId}-form`}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-5 md:px-8"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.title.trim()) onSave({ ...draft, title: draft.title.trim(), bookingLink: draft.bookingLink?.trim() || undefined });
          }}
        >
          <div>
            <label htmlFor={`${fieldId}-title`} className={label}>{t("reservation_field_title")}</label>
            <input
              id={`${fieldId}-title`}
              autoFocus
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
              placeholder={t("reservation_title_placeholder")}
              className={input}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${fieldId}-date`} className={label}>{t("reservation_field_date")}</label>
              <input id={`${fieldId}-date`} type="date" value={draft.reservationDate} onChange={(event) => set({ reservationDate: event.target.value })} className={`${input} tabular-nums`} />
            </div>
            <div>
              <label htmlFor={`${fieldId}-deadline`} className={label}>{t("reservation_field_deadline")}</label>
              <input id={`${fieldId}-deadline`} type="date" value={draft.bookingDeadline} onChange={(event) => set({ bookingDeadline: event.target.value })} className={`${input} tabular-nums`} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
            <div>
              <label htmlFor={`${fieldId}-price`} className={label}>{t("reservation_field_price")}</label>
              <input
                id={`${fieldId}-price`}
                type="number"
                min={0}
                inputMode="decimal"
                value={draft.price ?? ""}
                onChange={(event) => set({ price: event.target.value === "" ? undefined : Number(event.target.value) })}
                className={`${input} tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-link`} className={label}>{t("reservation_field_link")}</label>
              <input id={`${fieldId}-link`} type="url" value={draft.bookingLink ?? ""} onChange={(event) => set({ bookingLink: event.target.value })} placeholder="https://…" className={input} />
            </div>
          </div>
        </form>

        <footer className="flex items-center gap-2 border-t border-[var(--color-border)] px-5 py-4 md:px-8">
          {reservation && (
            <button
              type="button"
              onClick={async () => {
                if (await confirm({ message: t("reservation_delete_confirm", { title: reservation.title }) })) onDelete();
              }}
              aria-label={t("reservation_delete")}
              title={t("reservation_delete")}
              className="flex size-9 items-center justify-center rounded-xl text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            >
              <Trash2 size={16} />
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold text-[var(--color-text-secondary)]">
            {t("reservation_cancel")}
          </button>
          <button
            type="submit"
            form={`${fieldId}-form`}
            disabled={!draft.title.trim()}
            className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-xs font-bold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {t("reservation_save")}
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
