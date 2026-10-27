"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Crop, Download, ExternalLink, Loader2, QrCode, Share, Sparkles, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";
import { detectCodes, type CodeBox } from "@/lib/documents/codes";
import { DETECTION_SIDES_PX, loadDocument, pageImage, renderCrop, type DocPage } from "@/lib/documents/render";
import {
  cacheDocumentForOffline,
  getCachedDocumentAvailability,
  getCachedDocumentBlobUrl,
  openDocumentInNewTab,
  type DocumentOfflineStatus,
} from "@/lib/offline-documents";
import type { ActivityFile, FocusArea } from "@/lib/types";
import { useItineraryStore } from "@/store/use-itinerary-store";

/** A code on a page: found on the device, by the AI, or marked by the traveler. */
type PageCode = { page: number; kind: "qr" | "barcode"; value: string; box: CodeBox; source: "device" | "ai" | "manual" };

/** Pages are drawn this much sharper than the screen so a first zoom still looks crisp. */
const RENDER_SHARPNESS = 2;
const PAGE_GAP_PX = 12;
const MAX_COLUMN_PX = 900;
const AI_IMAGE_SIDE_PX = 1600;

export function DocumentViewer({
  file,
  activityTitle,
  onClose,
  onDelete,
}: {
  file: ActivityFile;
  activityTitle: string;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
  const setFileFocusArea = useItineraryStore((s) => s.setFileFocusArea);
  const containerRef = useRef<HTMLDivElement>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState<DocumentOfflineStatus>("pending");
  const [pages, setPages] = useState<DocPage[] | null>(null);
  const [images, setImages] = useState<Record<number, string>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  const [found, setFound] = useState<PageCode[]>([]);
  const [detecting, setDetecting] = useState(true);
  const [aiScanning, setAiScanning] = useState(false);
  const [manual, setManual] = useState<FocusArea | null>(file.focusArea ?? null);
  const [marking, setMarking] = useState(false);
  const [draft, setDraft] = useState<FocusArea | null>(null);
  const [spotlight, setSpotlight] = useState<number | null>(null);
  const [columnWidth, setColumnWidth] = useState(360);
  // Browser capabilities, read after mount so server and client render the same markup.
  const [browser, setBrowser] = useState({ online: true, canShare: false });
  useEffect(() => {
    const update = () => setBrowser({ online: navigator.onLine, canShare: "share" in navigator });
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Where the file is read from: the network, or this device's copy when offline.
  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    void (async () => {
      const cached = await getCachedDocumentAvailability(file.fileUrl);
      if (cancelled) return;
      setOfflineStatus(cached ? "available" : "unavailable");
      if (navigator.onLine) return setUrl(file.fileUrl);
      if (!cached) return setUnavailable(true);
      blobUrl = await getCachedDocumentBlobUrl(file.fileUrl);
      if (!cancelled) setUrl(blobUrl ?? file.fileUrl);
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [file.fileUrl]);

  useEffect(() => {
    const measure = () => {
      const width = containerRef.current?.getBoundingClientRect().width || window.innerWidth;
      setColumnWidth(Math.min(width, MAX_COLUMN_PX));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Every page, rendered and then searched for codes, one after another.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadDocument(url, file.fileType);
        if (cancelled) return;
        setPages(loaded);
        const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
        for (const [index, page] of loaded.entries()) {
          const canvas = await page.render(((columnWidthRef.current * ratio) / page.width) * RENDER_SHARPNESS / ratio);
          if (cancelled) return;
          setImages((current) => ({ ...current, [index]: canvas.toDataURL("image/png") }));
        }
        for (const [index, page] of loaded.entries()) {
          let codes: Awaited<ReturnType<typeof detectCodes>> = [];
          for (const side of DETECTION_SIDES_PX) {
            codes = await detectCodes(await pageImage(page, side));
            if (cancelled) return;
            if (codes.length > 0) break;
          }
          if (codes.length) setFound((current) => [...current, ...codes.map((code) => ({ page: index, kind: code.kind, value: code.value, box: code.box, source: "device" as const }))]);
        }
      } catch (error) {
        console.error("Document load failed:", error);
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.fileType, url]);

  const columnWidthRef = useRef(columnWidth);
  useEffect(() => {
    columnWidthRef.current = columnWidth;
  });

  const codes = useMemo<PageCode[]>(
    () => (manual ? [{ page: manual.page ?? 0, kind: "qr", value: "", box: manual, source: "manual" }, ...found] : found),
    [found, manual],
  );

  const pageHeights = useMemo(() => (pages ?? []).map((page) => (columnWidth * page.height) / page.width), [columnWidth, pages]);
  const content = useMemo(
    () => ({ width: columnWidth, height: pageHeights.reduce((sum, h) => sum + h, 0) + PAGE_GAP_PX * Math.max(pageHeights.length - 1, 0) }),
    [columnWidth, pageHeights],
  );
  const zoom = usePinchZoom(containerRef, content);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (spotlight !== null) setSpotlight(null);
      else if (marking) setMarking(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marking, onClose, spotlight]);

  const runAiScan = async () => {
    if (!pages?.[0]) return;
    setAiScanning(true);
    try {
      const first = pages[0];
      const canvas = await first.render(AI_IMAGE_SIDE_PX / Math.max(first.width, first.height));
      const response = await fetch("/api/detect-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUri: canvas.toDataURL("image/jpeg", 0.85) }),
      });
      const data = (await response.json()) as { regions?: { type: string; x: number; y: number; width: number; height: number }[] };
      // The AI returns centers on a 0-100 scale.
      const fromAi: PageCode[] = (data.regions ?? []).map((region) => ({
        page: 0,
        kind: region.type === "barcode" ? "barcode" : "qr",
        value: "",
        box: { x: (region.x - region.width / 2) / 100, y: (region.y - region.height / 2) / 100, width: region.width / 100, height: region.height / 100 },
        source: "ai",
      }));
      setFound((current) => [...current, ...fromAi]);
    } catch (error) {
      console.error("AI scan failed:", error);
    } finally {
      setAiScanning(false);
    }
  };

  // Marking a code by hand: drag a box on a page.
  const markStart = useRef<{ page: number; x: number; y: number } | null>(null);
  const pointOnPage = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1), y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1) };
  };
  const markHandlers = (page: number) =>
    marking
      ? {
          onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
            event.stopPropagation();
            markStart.current = { page, ...pointOnPage(event) };
            setDraft(null);
          },
          onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
            const start = markStart.current;
            if (!start || start.page !== page) return;
            event.stopPropagation();
            const point = pointOnPage(event);
            setDraft({
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              width: Math.abs(point.x - start.x),
              height: Math.abs(point.y - start.y),
              page,
            });
          },
          onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
            event.stopPropagation();
            markStart.current = null;
          },
        }
      : {};

  const saveMark = async () => {
    if (!draft || draft.width < 0.02 || draft.height < 0.02) return;
    const area = { x: round(draft.x), y: round(draft.y), width: round(draft.width), height: round(draft.height), page: draft.page ?? 0 };
    await setFileFocusArea(file.id, area);
    setManual(area);
    setMarking(false);
    setDraft(null);
  };

  const share = async () => {
    try {
      if (navigator.canShare) {
        const blob = await (await fetch(url ?? file.fileUrl)).blob();
        const shared = new File([blob], file.fileName, { type: blob.type });
        if (navigator.canShare({ files: [shared] })) {
          await navigator.share({ title: activityTitle, files: [shared] });
          return;
        }
      }
      await navigator.share?.({ title: activityTitle, text: t("wallet_share_text", { title: activityTitle }), url: file.fileUrl });
    } catch (error) {
      console.error("Share failed:", error);
    }
  };

  const keepOffline = async () => {
    setOfflineStatus("pending");
    setOfflineStatus((await cacheDocumentForOffline(file.fileUrl).catch(() => false)) ? "available" : "failed");
  };

  const kindLabel = (kind: PageCode["kind"]) => t(kind === "qr" ? "doc_code_qr" : "doc_code_barcode");
  const actionButton = "flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 text-white">
      {dialog}
      <header className="flex items-start gap-3 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-black">{activityTitle || file.fileName}</h2>
          <p className="truncate text-[11px] text-white/60">
            {file.fileName}
            {pages && pages.length > 1 ? ` · ${t("doc_page_count", { count: pages.length })}` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("doc_close")} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10">
          <X size={18} />
        </button>
      </header>

      <div
        ref={containerRef}
        className={`relative flex-1 overflow-hidden ${marking ? "cursor-crosshair" : "touch-none"}`}
        {...(marking ? {} : zoom.handlers)}
      >
        {unavailable ? (
          <p className="px-6 py-16 text-center text-sm text-white/70">{t("wallet_file_unavailable_offline")}</p>
        ) : loadFailed ? (
          <div className="space-y-3 px-6 py-16 text-center">
            <p className="text-sm text-white/70">{t("doc_load_failed")}</p>
            <button type="button" onClick={() => openDocumentInNewTab(file.fileUrl)} className={`${actionButton} mx-auto`}>
              <ExternalLink size={14} /> {t("wallet_open_original")}
            </button>
          </div>
        ) : !pages ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/70" role="status">
            <Loader2 size={18} className="animate-spin" /> {t("doc_loading")}
          </div>
        ) : (
          <div
            className="absolute left-0 top-0 will-change-transform"
            style={{
              width: columnWidth,
              transform: `translate(${zoom.state.x}px, ${zoom.state.y}px) scale(${zoom.state.scale})`,
              transformOrigin: "0 0",
            }}
          >
            {pages.map((page, index) => (
              <div
                key={index}
                data-testid={`doc-page-${index}`}
                className="relative overflow-hidden rounded-md bg-white"
                style={{ height: pageHeights[index], marginBottom: index < pages.length - 1 ? PAGE_GAP_PX : 0 }}
                {...markHandlers(index)}
              >
                {images[index] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- rendered page, not a static asset
                  <img src={images[index]} alt={t("doc_page_alt", { page: index + 1, total: pages.length })} draggable={false} className="h-full w-full select-none" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[var(--color-text-muted)]">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                )}
                {!marking &&
                  codes.map((code, codeIndex) =>
                    code.page === index ? (
                      <button
                        key={codeIndex}
                        type="button"
                        onClick={() => !zoom.wasGesture() && setSpotlight(codeIndex)}
                        aria-label={t("doc_open_code_on_page", { kind: t(code.kind === "qr" ? "doc_code_qr_inline" : "doc_code_barcode_inline"), page: index + 1 })}
                        className="absolute rounded-md ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-white/0 animate-pulse"
                        style={{ left: `${code.box.x * 100}%`, top: `${code.box.y * 100}%`, width: `${code.box.width * 100}%`, height: `${code.box.height * 100}%` }}
                      />
                    ) : null,
                  )}
                {marking && draft && (draft.page ?? 0) === index && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                    style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="space-y-2 border-t border-white/10 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3">
        {marking ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-white/70">{t("doc_mark_hint")}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setMarking(false); setDraft(null); }} className={actionButton}>{t("doc_mark_cancel")}</button>
              <button type="button" onClick={() => void saveMark()} disabled={!draft} className="rounded-xl bg-[var(--color-primary)] px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">
                {t("doc_mark_save")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {codes.length > 0 ? (
              <button
                type="button"
                onClick={() => setSpotlight(0)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-black text-white"
              >
                <QrCode size={18} /> {t("doc_show_code", { count: codes.length })}
              </button>
            ) : (
              detecting && pages && (
                <p className="flex items-center justify-center gap-2 text-[11px] text-white/60" role="status">
                  <Loader2 size={12} className="animate-spin" /> {t("doc_looking_for_codes")}
                </p>
              )
            )}
            <div className="flex flex-wrap items-center gap-2">
              {pages && (
                <button type="button" onClick={() => setMarking(true)} className={actionButton}>
                  <Crop size={14} /> {t("doc_mark_code")}
                </button>
              )}
              {pages && !detecting && found.length === 0 && browser.online && (
                <button type="button" onClick={() => void runAiScan()} disabled={aiScanning} className={actionButton}>
                  {aiScanning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {t("doc_ai_scan")}
                </button>
              )}
              <button type="button" onClick={() => openDocumentInNewTab(url ?? file.fileUrl)} className={actionButton}>
                <ExternalLink size={14} /> {t("wallet_open_original")}
              </button>
              <button type="button" onClick={() => void keepOffline()} disabled={offlineStatus === "available" || offlineStatus === "pending"} className={actionButton}>
                <Download size={14} /> {t(offlineStatus === "available" ? "offline_available" : "download_offline")}
              </button>
              {browser.canShare && (
                <button type="button" onClick={() => void share()} aria-label={t("doc_share")} className={actionButton}>
                  <Share size={14} />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={async () => {
                    if (await confirm({ message: t("wallet_delete_confirm") })) {
                      onDelete();
                      onClose();
                    }
                  }}
                  aria-label={t("doc_delete")}
                  className="ml-auto flex items-center rounded-xl px-3 py-2 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </>
        )}
      </footer>

      {spotlight !== null && pages && codes[spotlight] && (
        <CodeSpotlight
          codes={codes}
          index={spotlight}
          pages={pages}
          onIndex={setSpotlight}
          onClose={() => setSpotlight(null)}
          kindLabel={kindLabel}
        />
      )}
    </div>
  );
}

const round = (value: number) => Math.round(value * 10000) / 10000;

/** The code alone, large and sharp on white, with the screen kept awake for the scanner. */
function CodeSpotlight({
  codes,
  index,
  pages,
  onIndex,
  onClose,
  kindLabel,
}: {
  codes: PageCode[];
  index: number;
  pages: DocPage[];
  onIndex: (index: number) => void;
  onClose: () => void;
  kindLabel: (kind: PageCode["kind"]) => string;
}) {
  const { t } = useI18n();
  const code = codes[index];
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const page = pages[code.page];
    if (!page) return;
    void renderCrop(page, code.box, code.kind)
      .then((src) => !cancelled && setImage(src))
      .catch((error) => console.error("Code crop failed:", error));
    return () => {
      cancelled = true;
      setImage(null);
    };
  }, [code, pages]);

  // Scanners at a gate take a few seconds: keep the screen on while the code is shown.
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    let released = false;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    void wakeLock?.request("screen").then((lock) => {
      if (released) void lock.release();
      else sentinel = lock;
    }).catch(() => undefined);
    return () => {
      released = true;
      void sentinel?.release();
    };
  }, []);

  const go = useCallback((delta: number) => onIndex((index + delta + codes.length) % codes.length), [codes.length, index, onIndex]);
  const label = t("doc_code_position", { current: index + 1, total: codes.length });

  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[120] flex flex-col bg-white text-[#111]">
      <div className="flex items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
        <span className="text-xs font-black uppercase tracking-widest text-[#555]">{codes.length > 1 ? label : kindLabel(code.kind)}</span>
        <button type="button" onClick={onClose} aria-label={t("doc_close_code")} className="flex size-10 items-center justify-center rounded-full bg-black/5">
          <X size={20} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- cropped render of the code
          <img
            src={image}
            alt={kindLabel(code.kind)}
            className="max-h-full max-w-full object-contain"
            style={{ imageRendering: "pixelated", width: code.kind === "qr" ? "min(92vw, 70vh)" : "96vw" }}
          />
        ) : (
          <Loader2 size={28} className="animate-spin text-[#888]" />
        )}
      </div>
      <div className="space-y-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] text-center">
        {code.kind === "barcode" && code.value && <p className="font-mono text-lg tracking-widest">{code.value}</p>}
        <p className="text-xs text-[#666]">{t("doc_brightness_tip")}</p>
        {codes.length > 1 && (
          <div className="flex justify-center gap-3">
            <button type="button" onClick={() => go(-1)} aria-label={t("doc_previous_code")} className="flex size-11 items-center justify-center rounded-full bg-black/5">
              <ChevronLeft size={20} />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={t("doc_next_code")} className="flex size-11 items-center justify-center rounded-full bg-black/5">
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
