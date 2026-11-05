"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { format, isValid, parseISO } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { CalendarDays, Copy, File, FileText, FileUp, Image as ImageIcon } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { BOOKING_TYPE_ICONS } from "@/components/booking-import/labels";
import { cacheDocumentForOffline, getCachedDocumentAvailability, type DocumentOfflineStatus } from "@/lib/offline-documents";
import type { ActivityFile, BookingMoment, TripPlan } from "@/lib/types";
import {
  groupBookingsByType,
  groupDocumentsByDay,
  selectTodayBookings,
  selectTripBookings,
  selectTripDocuments,
  type BookingGroupKind,
  type WalletBooking,
  type WalletDocument,
} from "@/lib/wallet";

type WalletTab = "bookings" | "documents";

export type WalletViewProps = {
  trip: TripPlan;
  /** Today's date while the trip is in progress, else null (no "Today" group). */
  today: string | null;
  canImportBookings: boolean;
  /** The "To book" block (the critical reservations panel), shown under the bookings. */
  reservations: ReactNode;
  onOpenDocument: (file: ActivityFile, activityTitle: string) => void;
  onImportBookings: () => void;
  onShowActivity: (dayId: string, activityId: string) => void;
};

const FILE_ICONS = { pdf: FileText, image: ImageIcon, other: File } as const;

function useDateFormat() {
  const { lang } = useI18n();
  const locale = lang === "es" ? es : enUS;
  return (date: string | undefined, pattern: string) => {
    if (!date) return null;
    const parsed = parseISO(date);
    return isValid(parsed) ? format(parsed, pattern, { locale }) : date;
  };
}

/** Offline state per file; opening a file also saves it offline when there is a connection. */
function useOfflineStatuses(files: ActivityFile[]) {
  const [statuses, setStatuses] = useState<Record<string, DocumentOfflineStatus>>({});
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const next = await Promise.all(
        files.map(async (file) => [file.id, (await getCachedDocumentAvailability(file.fileUrl)) ? "available" : "unavailable"] as const)
      );
      if (cancelled) return;
      setStatuses((current) => {
        const updated = { ...current };
        for (const [id, status] of next) if (current[id] !== "pending") updated[id] = status;
        return updated;
      });
    };
    void sync();
    const onConnection = () => {
      setIsOnline(navigator.onLine);
      void sync();
    };
    window.addEventListener("online", onConnection);
    window.addEventListener("offline", onConnection);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onConnection);
      window.removeEventListener("offline", onConnection);
    };
  }, [files]);

  const saveOffline = async (file: ActivityFile) => {
    setStatuses((current) => ({ ...current, [file.id]: "pending" }));
    try {
      const cached = await cacheDocumentForOffline(file.fileUrl);
      setStatuses((current) => ({ ...current, [file.id]: cached ? "available" : "failed" }));
    } catch {
      setStatuses((current) => ({ ...current, [file.id]: "failed" }));
    }
  };

  return { statuses, isOnline, saveOffline };
}

export function WalletView({ trip, today, canImportBookings, reservations, onOpenDocument, onImportBookings, onShowActivity }: WalletViewProps) {
  const { t } = useI18n();
  const formatDate = useDateFormat();
  const [tab, setTab] = useState<WalletTab>("bookings");
  const baseId = useId();

  const bookings = useMemo(() => selectTripBookings(trip), [trip]);
  const documents = useMemo(() => selectTripDocuments(trip), [trip]);
  const todayBookings = useMemo(() => (today ? selectTodayBookings(bookings, today) : []), [bookings, today]);
  const typeGroups = useMemo(
    () => groupBookingsByType(bookings.filter((b) => !todayBookings.includes(b))),
    [bookings, todayBookings]
  );
  const files = useMemo(() => documents.map((d) => d.file), [documents]);
  const titleByFile = useMemo(() => new Map(documents.map((d) => [d.file.id, d.activityTitle])), [documents]);
  const { statuses, isOnline, saveOffline } = useOfflineStatuses(files);

  const openDocument = (file: ActivityFile, fallbackTitle: string) => {
    if (statuses[file.id] !== "available" && isOnline) void saveOffline(file);
    onOpenDocument(file, titleByFile.get(file.id) ?? fallbackTitle);
  };

  const groupLabels: Record<BookingGroupKind, string> = {
    flights: t("wallet_view_group_flights"),
    lodging: t("wallet_view_group_lodging"),
    transport: t("wallet_view_group_transport"),
    tickets: t("wallet_view_group_tickets"),
    other: t("wallet_view_group_other"),
  };

  const tabs: { id: WalletTab; label: string }[] = [
    { id: "bookings", label: t("wallet_view_tab_bookings") },
    { id: "documents", label: t("wallet_view_tab_documents") },
  ];

  const offlineBadge = (status: DocumentOfflineStatus | undefined) => {
    if (status === "available") return { label: t("offline_available"), tone: "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]" };
    if (status === "pending") return { label: t("offline_caching"), tone: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]" };
    if (status === "failed") return { label: t("offline_failed"), tone: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]" };
    return {
      label: isOnline ? t("offline_not_cached") : t("offline_unavailable"),
      tone: "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
    };
  };

  const renderGroup = (key: string, title: string, items: WalletBooking[]) => (
    <section key={key} className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((booking) => (
          <BookingCard
            key={booking.groupId}
            booking={booking}
            formatDate={formatDate}
            onOpenDocument={(file) => openDocument(file, booking.title)}
            onShowActivity={onShowActivity}
          />
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label={t("section_wallet")}
        className="grid grid-cols-2 gap-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-1"
      >
        {tabs.map(({ id, label }) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              id={`${baseId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              onClick={() => setTab(id)}
              className={`min-h-11 rounded-xl px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 ${
                selected
                  ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`} className="space-y-6">
        {tab === "bookings" ? (
          <>
            {bookings.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">{t("wallet_view_no_bookings")}</p>
                {canImportBookings && (
                  <button
                    type="button"
                    onClick={onImportBookings}
                    className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white hover:bg-[var(--color-primary-hover)]"
                  >
                    <FileUp size={16} aria-hidden="true" />
                    {t("booking_import_action")}
                  </button>
                )}
              </div>
            ) : (
              <>
                {todayBookings.length > 0 && renderGroup("today", t("today"), todayBookings)}
                {typeGroups.map((group) => renderGroup(group.kind, groupLabels[group.kind], group.bookings))}
              </>
            )}
            {reservations}
          </>
        ) : documents.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center text-sm font-medium text-[var(--color-text-secondary)]">
            {t("wallet_view_no_documents")}
          </p>
        ) : (
          groupDocumentsByDay(documents).map((group) => (
            <section key={group.dayId} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                {formatDate(group.dayDate, "EEEE d MMMM") ?? t("wallet_view_no_date")}
              </h3>
              <ul className="space-y-2">
                {group.documents.map((doc) => (
                  <DocumentRow key={doc.file.id} doc={doc} badge={offlineBadge(statuses[doc.file.id])} onOpen={() => openDocument(doc.file, doc.activityTitle)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function momentText(moment: BookingMoment | undefined, formatDate: ReturnType<typeof useDateFormat>) {
  if (!moment?.date) return null;
  return [formatDate(moment.date, "EEE d MMM"), moment.time].filter(Boolean).join(" · ");
}

function BookingCard({
  booking,
  formatDate,
  onOpenDocument,
  onShowActivity,
}: {
  booking: WalletBooking;
  formatDate: ReturnType<typeof useDateFormat>;
  onOpenDocument: (file: ActivityFile) => void;
  onShowActivity: (dayId: string, activityId: string) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const Icon = BOOKING_TYPE_ICONS[booking.type];
  const start = momentText(booking.start, formatDate);
  const end = momentText(booking.end, formatDate);
  const place = booking.from && booking.to ? `${booking.from} → ${booking.to}` : booking.address ?? booking.from ?? booking.to;

  const copyReference = async () => {
    if (!booking.reference) return;
    try {
      await navigator.clipboard?.writeText(booking.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied: the reference stays selectable on screen.
    }
  };

  return (
    <article aria-labelledby={titleId} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-subtle)] text-[var(--color-primary)]">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h4 id={titleId} className="font-bold leading-tight text-[var(--color-text)]">{booking.title}</h4>
          {start && (
            <p className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
              <CalendarDays size={12} aria-hidden="true" />
              {end && end !== start ? `${start} – ${end}` : start}
            </p>
          )}
          {place && <p className="truncate text-xs text-[var(--color-text-secondary)]">{place}</p>}
        </div>
      </div>

      {(booking.provider || booking.reference) && (
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {booking.provider && (
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{t("booking_import_field_provider")}</dt>
              <dd className="font-medium text-[var(--color-text)]">{booking.provider}</dd>
            </div>
          )}
          {booking.reference && (
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{t("booking_import_field_reference")}</dt>
              <dd className="flex items-center gap-1">
                <span className="select-all font-mono font-bold text-[var(--color-text)]">{booking.reference}</span>
                <button
                  type="button"
                  onClick={copyReference}
                  aria-label={copied ? t("wallet_view_reference_copied") : t("wallet_view_copy_reference")}
                  title={copied ? t("wallet_view_reference_copied") : t("wallet_view_copy_reference")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-primary)]"
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {booking.documents.map((file) => {
          const FileIcon = FILE_ICONS[file.fileType] ?? File;
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => onOpenDocument(file)}
              className="flex min-h-11 max-w-full items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-xs font-bold text-white hover:bg-[var(--color-primary-hover)]"
            >
              <FileIcon size={14} aria-hidden="true" />
              <span className="truncate">{file.fileName}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onShowActivity(booking.dayIds[0], booking.activityIds[0])}
          className="min-h-11 rounded-xl px-4 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]"
        >
          {t("wallet_view_show_in_itinerary")}
        </button>
      </div>
    </article>
  );
}

function DocumentRow({ doc, badge, onOpen }: { doc: WalletDocument; badge: { label: string; tone: string }; onOpen: () => void }) {
  const Icon = doc.bookingType ? BOOKING_TYPE_ICONS[doc.bookingType] : FILE_ICONS[doc.file.fileType] ?? File;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left hover:border-[var(--color-primary)]/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]">
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-[var(--color-text)]">{doc.file.fileName}</span>
          <span className="block truncate text-xs text-[var(--color-text-secondary)]">{doc.activityTitle}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${badge.tone}`}>{badge.label}</span>
      </button>
    </li>
  );
}
