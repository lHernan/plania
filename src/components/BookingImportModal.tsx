"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, CloudUpload, ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { supabase } from "@/lib/supabase";
import { readPdf, PdfReadError } from "@/lib/pdf/read-pdf";
import type { ExtractedBooking } from "@/lib/bookings/extract";
import {
  buildBookingActivities,
  confirmBlockers,
  createReviewItems,
  type ReviewItem,
} from "@/lib/bookings/import-session";
import { bookingToActivities } from "@/lib/bookings/to-activities";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { FileRow, type FileEntry } from "@/components/booking-import/FileRow";
import { BookingReviewCard } from "@/components/booking-import/BookingReviewCard";
import { PlanStep } from "@/components/booking-import/PlanStep";
import type { FileErrorCode } from "@/components/booking-import/labels";

/** Three at once: a trip often brings one document per traveler, and the AI answer takes many seconds. */
const CONCURRENCY = 3;
const MIGRATION_FILE = "src/lib/booking_import_migration.sql";

type Step = "files" | "review" | "plan";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Trip dates for the extraction route, only when both are valid ISO dates. */
export function tripDatesForExtraction(trip: { startDate?: string; endDate?: string } | null | undefined) {
  const start = trip?.startDate;
  const end = trip?.endDate;
  return start && end && ISO_DATE.test(start) && ISO_DATE.test(end) ? { tripStartDate: start, tripEndDate: end } : {};
}

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function needsMigration(error: string): boolean {
  return /(origin|booking)/i.test(error) && /(column|schema)/i.test(error);
}

/**
 * "Import bookings": PDFs → extraction → review → confirm (booking activities + one file upload per
 * document) → optional itinerary generation through the existing importer. Nothing is persisted
 * before the user confirms the review.
 */
export function BookingImportModal({ onClose, onToast }: { onClose: () => void; onToast: (msg: string, type?: "success" | "error") => void }) {
  const { t, lang } = useI18n();
  const reducedMotion = useReducedMotion();
  const titleId = useId();
  const inputId = useId();
  const firstControlRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTrip = useItineraryStore((s) => s.activeTrip);
  const addActivitiesBatch = useItineraryStore((s) => s.addActivitiesBatch);
  const uploadActivityFile = useItineraryStore((s) => s.uploadActivityFile);

  const [step, setStep] = useState<Step>("files");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ count: number; uploadFailures: number } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Files, results and object URLs live in refs: they never leave the browser before confirm.
  const blobs = useRef(new Map<string, File>());
  const results = useRef(new Map<string, ExtractedBooking[]>());
  const urls = useRef(new Map<string, string>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const counter = useRef(0);

  useEffect(() => {
    firstControlRef.current?.focus();
    const objectUrls = urls.current;
    return () => {
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, []);

  const patchFile = useCallback((id: string, patch: Partial<FileEntry>) => {
    setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const processFile = useCallback(async (id: string) => {
    const file = blobs.current.get(id);
    if (!file) return;
    const fail = (error: FileErrorCode) => {
      if (blobs.current.has(id)) patchFile(id, { status: "error", error });
    };

    patchFile(id, { status: "reading", error: undefined });
    let read: Awaited<ReturnType<typeof readPdf>>;
    try {
      read = await readPdf(file);
    } catch (error) {
      fail(error instanceof PdfReadError ? error.code : "invalid");
      return;
    }
    if (!blobs.current.has(id)) return;

    patchFile(id, { status: "analyzing" });
    let response: Response;
    try {
      response = await fetch("/api/bookings/extract", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          sha256: read.sha256,
          pages: read.pages,
          ...(read.imagePages.length ? { images: read.imagePages } : {}),
          lang,
          // Lets the server complete dates printed without a year (e.g. "Sat, Oct 31").
          ...tripDatesForExtraction(activeTrip),
        }),
      });
    } catch {
      fail("network");
      return;
    }
    if (!response.ok) {
      fail(response.status === 422 ? "no_text" : response.status === 401 ? "unauthorized" : "extraction_failed");
      return;
    }
    try {
      const data = await response.json() as { bookings?: ExtractedBooking[]; warnings?: string[] };
      const bookings = Array.isArray(data.bookings) ? data.bookings : [];
      if (!blobs.current.has(id)) return;
      results.current.set(id, bookings);
      patchFile(id, { status: "done", bookingCount: bookings.length, warnings: Array.isArray(data.warnings) ? data.warnings : [] });
    } catch {
      fail("extraction_failed");
    }
  }, [lang, patchFile, activeTrip]);

  // At most CONCURRENCY documents are read/analyzed at once; one failure never blocks the rest.
  const pump = useCallback(() => {
    const startNext = () => {
      while (active.current < CONCURRENCY && queue.current.length > 0) {
        const id = queue.current.shift()!;
        active.current += 1;
        void processFile(id).finally(() => {
          active.current -= 1;
          startNext();
        });
      }
    };
    startNext();
  }, [processFile]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const all = Array.from(list);
    const pdfs = all.filter(isPdf);
    setIgnoredCount(all.length - pdfs.length);
    const entries: FileEntry[] = pdfs.map((file) => {
      counter.current += 1;
      const id = `file-${counter.current}`;
      blobs.current.set(id, file);
      return { id, name: file.name, status: "queued", bookingCount: 0, warnings: [] };
    });
    if (!entries.length) return;
    setFiles((current) => [...current, ...entries]);
    queue.current.push(...entries.map((e) => e.id));
    pump();
  };

  const retryFile = (id: string) => {
    patchFile(id, { status: "queued", error: undefined });
    queue.current.push(id);
    pump();
  };

  const removeFile = (id: string) => {
    blobs.current.delete(id);
    results.current.delete(id);
    queue.current = queue.current.filter((q) => q !== id);
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
    setFiles((list) => list.filter((f) => f.id !== id));
    setItems((list) => list.filter((i) => i.fileId !== id));
  };

  const viewDocument = (fileId: string) => {
    const file = blobs.current.get(fileId);
    if (!file) return;
    let url = urls.current.get(fileId);
    if (!url) {
      url = URL.createObjectURL(file);
      urls.current.set(fileId, url);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const doneFiles = files.filter((f) => f.status === "done");
  const processing = files.some((f) => f.status === "queued" || f.status === "reading" || f.status === "analyzing");
  const totalBookings = doneFiles.reduce((sum, f) => sum + f.bookingCount, 0);

  const goToReview = () => {
    const existing = (activeTrip?.days ?? []).flatMap((d) => d.activities);
    const fresh = createReviewItems(
      doneFiles.map((f) => ({ fileId: f.id, bookings: results.current.get(f.id) ?? [] })),
      existing,
    );
    // Returning to the files step must not lose the edits already made.
    setItems((previous) => fresh.map((item) => previous.find((p) => p.id === item.id) ?? item));
    setSaveError(null);
    setStep("review");
  };

  const days = useMemo(() => activeTrip?.days ?? [], [activeTrip]);
  const tripRange = {
    start: activeTrip?.startDate ?? days[0]?.date ?? "",
    end: activeTrip?.endDate ?? days[days.length - 1]?.date ?? "",
  };
  const blockers = useMemo(() => confirmBlockers(items, days), [items, days]);
  const includedCount = items.filter((i) => i.included).length;
  const confirmable = includedCount > 0 && blockers.length === 0;
  const doubtCount = blockers.filter((b) => b.reason === "doubts").length;
  const outsideCount = blockers.filter((b) => b.reason === "outside_trip").length;

  const confirm = async () => {
    if (!confirmable || saving) return;
    setSaving(true);
    setSaveError(null);
    const { activities, uploads } = buildBookingActivities(items, days, lang === "es" ? "es" : "en");
    const result = await addActivitiesBatch(activities);
    if (!result.ok) {
      setSaving(false);
      const message = result.error === "offline"
        ? t("booking_import_offline")
        : t("booking_import_save_failed", { error: result.error });
      setSaveError(needsMigration(result.error) ? `${message} ${t("booking_import_migration_hint", { file: MIGRATION_FILE })}` : message);
      return;
    }

    let uploadFailures = 0;
    for (const upload of uploads) {
      const file = blobs.current.get(upload.fileId);
      const activityId = result.ids[upload.activityIndex];
      if (!file || !activityId) continue;
      const before = useItineraryStore.getState().error;
      try {
        await uploadActivityFile(activityId, file);
        const after = useItineraryStore.getState().error;
        if (after && after !== before) uploadFailures += 1;
      } catch {
        uploadFailures += 1;
      }
    }
    setSaving(false);
    setSaved({ count: activities.length, uploadFailures });
    setStep("plan");
  };

  const hasUnsavedWork = !saved && (files.length > 0 || items.length > 0);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (hasUnsavedWork) setConfirmLeave(true);
    else onClose();
  }, [hasUnsavedWork, onClose, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (confirmLeave) setConfirmLeave(false);
      else requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmLeave, requestClose]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer?.files ?? null);
  };

  const finish = (message: string) => {
    onToast(message, "success");
    onClose();
  };

  const stepIndex = { files: 0, review: 1, plan: 2 }[step];
  const progressText = files.length
    ? t("booking_import_progress", { done: files.filter((f) => f.status === "done" || f.status === "error").length, total: files.length })
    : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-6" onClick={requestClose}>
      <motion.div
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm"
        aria-hidden="true"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reducedMotion ? false : { y: "100%" }}
        animate={{ y: 0 }}
        transition={reducedMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-2xl md:max-h-[85dvh] md:rounded-2xl"
      >
        <header className="flex items-start gap-3 border-b border-[var(--color-border)] px-5 pb-4 pt-5 md:px-8">
          {step === "review" && (
            <button
              type="button"
              onClick={() => setStep("files")}
              aria-label={t("booking_import_back")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-subtle)]"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-black text-[var(--color-text)]">{t("booking_import_title")}</h2>
            <p className="text-xs text-[var(--color-text-secondary)]">{t("booking_import_subtitle")}</p>
            <ol className="mt-3 flex gap-2 text-[10px] font-black uppercase tracking-widest" aria-label={t("booking_import_steps")}>
              {(["booking_import_step_files", "booking_import_step_review", "booking_import_step_plan"] as const).map((key, index) => (
                <li
                  key={key}
                  aria-current={index === stepIndex ? "step" : undefined}
                  className={`rounded-full px-2.5 py-1 ${index === stepIndex ? "bg-[var(--color-primary)] text-white" : index < stepIndex ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]" : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]"}`}
                >
                  {t(key)}
                </li>
              ))}
            </ol>
          </div>
          <button
            ref={firstControlRef}
            type="button"
            onClick={requestClose}
            aria-label={t("booking_import_close")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <p className="sr-only" aria-live="polite">{progressText}</p>

        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-8">
          {step === "files" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                data-testid="booking-dropzone"
                className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)]" : "border-[var(--color-border)] bg-[var(--color-surface-subtle)]"}`}
              >
                <CloudUpload size={32} className="mx-auto text-[var(--color-primary)]" aria-hidden="true" />
                <p className="mt-2 text-sm font-black text-[var(--color-text)]">{t("booking_import_drop_title")}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{t("booking_import_drop_hint")}</p>
                <label htmlFor={inputId} className="sr-only">{t("booking_import_file_input_label")}</label>
                <input
                  id={inputId}
                  ref={inputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-4 min-h-[44px] rounded-xl bg-[var(--color-primary)] px-5 text-sm font-black text-white"
                >
                  {t("booking_import_choose_files")}
                </button>
              </div>

              <p className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                <span>{t("booking_import_privacy")}</span>
              </p>

              {ignoredCount > 0 && <p className="text-xs text-[var(--color-warning)]">{t("booking_import_only_pdf", { count: ignoredCount })}</p>}

              {files.length > 0 && (
                <ul className="space-y-2" aria-label={t("booking_import_step_files")}>
                  {files.map((entry) => (
                    <FileRow key={entry.id} entry={entry} onRetry={() => retryFile(entry.id)} onRemove={() => removeFile(entry.id)} />
                  ))}
                </ul>
              )}

              {!processing && doneFiles.length > 0 && totalBookings === 0 && (
                <p className="text-sm text-[var(--color-text-secondary)]">{t("booking_import_no_bookings_found")}</p>
              )}
            </div>
          )}

          {step === "review" && (
            <div className="space-y-6">
              <p className="text-sm text-[var(--color-text-secondary)]">{t("booking_import_review_intro")}</p>
              {doneFiles.map((file) => {
                const fileItems = items.filter((i) => i.fileId === file.id);
                if (!fileItems.length) return null;
                return (
                  <section key={file.id} aria-label={file.name} className="space-y-3">
                    <h3 className="truncate text-xs font-black uppercase tracking-widest text-[var(--color-text-muted)]">{file.name}</h3>
                    {fileItems.map((item) => (
                      <BookingReviewCard
                        key={item.id}
                        item={item}
                        problems={bookingToActivities(item.booking, days, "en").problems}
                        tripRange={tripRange}
                        onChange={(next) => setItems((list) => list.map((i) => (i.id === next.id ? next : i)))}
                        onViewDocument={() => viewDocument(item.fileId)}
                      />
                    ))}
                  </section>
                );
              })}
              {saveError && (
                <p role="alert" className="rounded-xl bg-[var(--color-danger)]/10 px-3 py-2 text-xs font-bold text-[var(--color-danger)]">{saveError}</p>
              )}
            </div>
          )}

          {step === "plan" && saved && (
            <div className="space-y-5">
              <div className="rounded-2xl bg-[var(--color-primary-subtle)] p-4">
                <p className="text-base font-black text-[var(--color-primary)]">{t("booking_import_saved_title")}</p>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t("booking_import_saved_body", { count: saved.count })}</p>
                {saved.uploadFailures > 0 && (
                  <p role="status" className="mt-2 text-xs font-bold text-[var(--color-warning)]">{t("booking_import_upload_warning", { count: saved.uploadFailures })}</p>
                )}
              </div>
              <PlanStep authHeaders={authHeaders} onSaved={finish} />
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 md:px-8" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {confirmLeave ? (
            <div role="alertdialog" aria-label={t("booking_import_discard_title")} className="space-y-3">
              <p className="text-sm font-black text-[var(--color-text)]">{t("booking_import_discard_title")}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{t("booking_import_discard_body")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirmLeave(false)} className="min-h-[44px] flex-1 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-black text-white">
                  {t("booking_import_keep_working")}
                </button>
                <button type="button" onClick={onClose} className="min-h-[44px] flex-1 rounded-xl border border-[var(--color-danger)]/40 px-4 text-sm font-bold text-[var(--color-danger)]">
                  {t("booking_import_discard_confirm")}
                </button>
              </div>
            </div>
          ) : step === "files" ? (
            <button
              type="button"
              onClick={goToReview}
              disabled={processing || totalBookings === 0}
              className="min-h-[48px] w-full rounded-xl bg-[var(--color-primary)] px-4 text-sm font-black text-white disabled:opacity-50"
            >
              {t("booking_import_continue_review")}
            </button>
          ) : step === "review" ? (
            <div className="space-y-2">
              {!confirmable && (
                <p className="text-xs text-[var(--color-text-secondary)]" data-testid="confirm-blocked-reason">
                  {includedCount === 0
                    ? t("booking_import_confirm_none")
                    : [
                        doubtCount ? t("booking_import_confirm_doubts", { count: doubtCount }) : "",
                        outsideCount ? t("booking_import_confirm_outside", { count: outsideCount }) : "",
                      ].filter(Boolean).join(" ")}
                </p>
              )}
              <button
                type="button"
                onClick={confirm}
                disabled={!confirmable || saving}
                className="min-h-[48px] w-full rounded-xl bg-[var(--color-primary)] px-4 text-sm font-black text-white disabled:opacity-50"
              >
                {saving ? t("booking_import_saving") : t("booking_import_confirm", { count: includedCount })}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => finish(t("booking_import_success_bookings"))}
              className="min-h-[44px] w-full rounded-xl px-4 text-sm font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
            >
              {t("booking_import_skip")}
            </button>
          )}
        </footer>
      </motion.div>
    </div>
  );
}
