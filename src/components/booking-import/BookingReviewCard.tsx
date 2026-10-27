"use client";

import { useId, useState } from "react";
import { Copy, ExternalLink, Pencil } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import type { BookingField, BookingMoment } from "@/lib/types";
import {
  confirmBookingReviewed,
  editBookingField,
  pendingDoubts,
  type EditError,
  type ReviewItem,
} from "@/lib/bookings/import-session";
import type { BookingProblem } from "@/lib/bookings/to-activities";
import { BOOKING_TYPE_ICONS, bookingTypeLabel, fieldLabel, warningLabel } from "./labels";

type Flag = "review" | "estimated" | "confirmed" | null;

const EDIT_FIELDS: { field: BookingField; type: "text" | "date" | "time" }[] = [
  { field: "title", type: "text" },
  { field: "provider", type: "text" },
  { field: "reference", type: "text" },
  { field: "startDate", type: "date" },
  { field: "startTime", type: "time" },
  { field: "endDate", type: "date" },
  { field: "endTime", type: "time" },
  { field: "timeZone", type: "text" },
  { field: "from", type: "text" },
  { field: "to", type: "text" },
  { field: "address", type: "text" },
  { field: "pickupLocation", type: "text" },
  { field: "dropoffLocation", type: "text" },
];

const TEXT_FIELDS = ["provider", "reference", "from", "to", "address", "pickupLocation", "dropoffLocation"] as const;

function valueOf(item: ReviewItem, field: BookingField): string {
  const b = item.booking;
  switch (field) {
    case "startDate": return b.start?.date ?? "";
    case "startTime": return b.start?.time ?? "";
    case "endDate": return b.end?.date ?? "";
    case "endTime": return b.end?.time ?? "";
    case "timeZone": return b.start?.timeZone ?? b.end?.timeZone ?? "";
    case "title": return b.title;
    default: return b[field] ?? "";
  }
}

function FlagBadge({ flag }: { flag: Flag }) {
  const { t } = useI18n();
  if (!flag) return null;
  const styles = {
    review: "bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/40",
    estimated: "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] border-dashed border-[var(--color-border)]",
    confirmed: "bg-[var(--color-primary-subtle)] text-[var(--color-primary)] border-[var(--color-primary)]/30",
  }[flag];
  const key = { review: "booking_import_flag_review", estimated: "booking_import_flag_estimated", confirmed: "booking_import_flag_confirmed" }[flag];
  return (
    <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${styles}`}>
      {t(key)}
    </span>
  );
}

export function BookingReviewCard({
  item,
  problems,
  tripRange,
  onChange,
  onViewDocument,
}: {
  item: ReviewItem;
  problems: BookingProblem[];
  tripRange: { start: string; end: string };
  onChange: (item: ReviewItem) => void;
  onViewDocument: () => void;
}) {
  const { t } = useI18n();
  const baseId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Partial<Record<BookingField, EditError>>>({});

  const { booking } = item;
  const doubts = pendingDoubts(item);
  const confirmed = new Set(booking.userConfirmedFields ?? []);
  const Icon = BOOKING_TYPE_ICONS[booking.type];
  const titleId = `${baseId}-title`;

  const flagFor = (field: BookingField): Flag => {
    if (doubts.includes(field)) return "review";
    if (confirmed.has(field)) return "confirmed";
    if (booking.fieldStatus[field] === "estimated") return "estimated";
    return null;
  };
  const momentFlag = (fields: BookingField[]): Flag => {
    const flags = fields.map(flagFor);
    return flags.includes("review") ? "review" : flags.includes("estimated") ? "estimated" : flags.includes("confirmed") ? "confirmed" : null;
  };

  const startEditing = () => {
    setDraft(Object.fromEntries(EDIT_FIELDS.map(({ field }) => [field, valueOf(item, field)])));
    setErrors({});
    setEditing(true);
  };

  const saveEdits = () => {
    let next = item;
    const nextErrors: Partial<Record<BookingField, EditError>> = {};
    for (const { field } of EDIT_FIELDS) {
      const value = draft[field] ?? "";
      if (value.trim() === valueOf(item, field)) continue;
      const result = editBookingField(next, field, value);
      if (result.ok) next = result.item;
      else nextErrors[field] = result.error;
    }
    setErrors(nextErrors);
    if (next !== item) onChange(next);
    if (Object.keys(nextErrors).length === 0) setEditing(false);
  };

  const moment = (m: BookingMoment | undefined) =>
    m?.date || m?.time ? [m.date, m.time, m.timeZone].filter(Boolean).join(" · ") : "—";

  const rows: { label: string; value: string; flag: Flag }[] = [
    { label: t("booking_import_starts"), value: moment(booking.start), flag: momentFlag(["startDate", "startTime", "timeZone"]) },
    ...(booking.end || doubts.includes("endDate")
      ? [{ label: t("booking_import_ends"), value: moment(booking.end), flag: momentFlag(["endDate", "endTime"]) }]
      : []),
    ...TEXT_FIELDS.filter((f) => booking[f] || doubts.includes(f)).map((f) => ({
      label: fieldLabel(t, f),
      value: booking[f] ?? "—",
      flag: flagFor(f),
    })),
  ];

  return (
    <article
      aria-labelledby={titleId}
      data-testid={`booking-card-${item.id}`}
      className={`rounded-2xl border p-4 transition-opacity ${
        item.included ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] opacity-80"
      }`}
    >
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-subtle)] text-[var(--color-primary)]" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)]">{bookingTypeLabel(t, booking.type)}</p>
          <h4 id={titleId} className="text-base font-black text-[var(--color-text)]">
            {booking.title || t("booking_import_untitled")}
            <FlagBadge flag={flagFor("title")} />
          </h4>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-bold text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            checked={item.included}
            onChange={(e) => onChange({ ...item, included: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
          {t("booking_import_include")}
        </label>
      </header>

      {item.duplicate && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--color-surface-subtle)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <Copy size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-black text-[var(--color-text)]">
              {t(item.duplicate.kind === "existing" ? "booking_import_duplicate_existing" : "booking_import_duplicate_batch")}
            </span>{" "}
            ({t(`booking_import_duplicate_reason_${item.duplicate.reason}`)}). {t("booking_import_duplicate_hint")}
          </p>
        </div>
      )}

      {!editing ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className={`rounded-lg px-2 py-1 ${row.flag === "review" ? "bg-[var(--color-warning)]/10" : ""}`}>
              <dt className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)]">
                {row.label}
                <FlagBadge flag={row.flag} />
              </dt>
              <dd className="break-words text-sm font-medium text-[var(--color-text)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EDIT_FIELDS.map(({ field, type }) => {
            const inputId = `${baseId}-${field}`;
            const error = errors[field];
            return (
              <div key={field}>
                <label htmlFor={inputId} className="block text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)]">
                  {fieldLabel(t, field)}
                  <FlagBadge flag={flagFor(field)} />
                </label>
                <input
                  id={inputId}
                  type={type}
                  value={draft[field] ?? ""}
                  placeholder={field === "timeZone" ? "Atlantic/Canary" : undefined}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                />
                {error && (
                  <p id={`${inputId}-error`} className="mt-1 text-xs text-[var(--color-danger)]">{t(`booking_import_edit_${error}`)}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {booking.details && !editing && <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{booking.details}</p>}

      {booking.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-warning)]">
          {booking.warnings.map((code) => <li key={code}>{warningLabel(t, code)}</li>)}
        </ul>
      )}

      {item.included && doubts.length > 0 && (
        <p className="mt-2 text-xs font-bold text-[var(--color-warning)]" role="note">
          {t("booking_import_pending_fields", { fields: doubts.map((f) => fieldLabel(t, f)).join(", ") })}
        </p>
      )}
      {item.included && problems.includes("outside_trip_dates") && (
        <p className="mt-2 text-xs font-bold text-[var(--color-danger)]" role="note">
          {t("booking_import_outside_trip", { start: tripRange.start, end: tripRange.end })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button type="button" onClick={saveEdits} className="min-h-[36px] rounded-lg bg-[var(--color-primary)] px-3 text-xs font-black text-white">
              {t("booking_import_save_edits")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-[36px] rounded-lg px-3 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]">
              {t("booking_import_cancel_edits")}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={startEditing} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]">
              <Pencil size={14} aria-hidden="true" />
              {t("booking_import_edit")}
            </button>
            {doubts.length > 0 && (
              <button
                type="button"
                onClick={() => onChange(confirmBookingReviewed(item))}
                className="min-h-[36px] rounded-lg border border-[var(--color-warning)]/40 px-3 text-xs font-bold text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
              >
                {t("booking_import_mark_reviewed")}
              </button>
            )}
          </>
        )}
        <button type="button" onClick={onViewDocument} className="ml-auto inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]">
          <ExternalLink size={14} aria-hidden="true" />
          {t("booking_import_view_document")}
        </button>
      </div>
    </article>
  );
}
