"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { 
  X, 
  Share, 
  ExternalLink, 
  Trash2, 
  Maximize2, 
  Download,
  QrCode,
  FileText,
  Loader2,
  Sparkles,
  Settings
} from "lucide-react";
import jsQR from "jsqr";
import { ActivityFile } from "@/lib/types";
import { cacheDocumentForOffline, getCachedDocumentAvailability, getCachedDocumentBlobUrl, openDocumentInNewTab, type DocumentOfflineStatus } from "@/lib/offline-documents";
import { useItineraryStore } from "@/store/use-itinerary-store";

interface WalletPreviewModalProps {
  file: ActivityFile;
  onClose: () => void;
  onDelete?: () => void;
  activityTitle: string;
}

export function WalletPreviewModal({ file, onClose, onDelete, activityTitle }: WalletPreviewModalProps) {
  const [qrContent, setQrContent] = useState<string | null>(null);
  const [isQrZoomed, setIsQrZoomed] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [zoomPosition, setZoomPosition] = useState<"center" | "top" | "bottom" | "qr" | "ai">("center");
  const [qrPos, setQrPos] = useState<{ x: number, y: number } | null>(null);
  const [aiRegions, setAiRegions] = useState<{ type: string; x: number; y: number; width: number; height: number; label: string }[]>([]);
  const [isAiScanning, setIsAiScanning] = useState(false);
  const [activeAiRegion, setActiveAiRegion] = useState<number | null>(null);
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tempFocusArea, setTempFocusArea] = useState<import("@/lib/types").FocusArea | null>(file.focusArea || null);
  const [offlineStatus, setOfflineStatus] = useState<DocumentOfflineStatus>("pending");
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);
  const [resolvedFileUrl, setResolvedFileUrl] = useState(file.fileUrl);
  const containerRef = useRef<HTMLDivElement>(null);
  const cachedBlobUrlRef = useRef<string | null>(null);
  const setFileFocusArea = useItineraryStore((s) => s.setFileFocusArea);

  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 300], [1, 0]);
  const scale = useTransform(y, [0, 300], [1, 0.9]);

  useEffect(() => {
    let cancelled = false;

    const syncOfflineState = async () => {
      const available = await getCachedDocumentAvailability(file.fileUrl);
      if (cancelled) return;

      setOfflineStatus(available ? "available" : "unavailable");

      if (!navigator.onLine && !available) {
        setOfflineMessage("This file is not available offline");
        setResolvedFileUrl(file.fileUrl);
        setPdfPreviewUrl(null);
        return;
      }

      if (!navigator.onLine && available) {
        const cachedBlobUrl = await getCachedDocumentBlobUrl(file.fileUrl);
        if (cancelled) return;

        if (cachedBlobUrlRef.current) {
          URL.revokeObjectURL(cachedBlobUrlRef.current);
        }

        cachedBlobUrlRef.current = cachedBlobUrl;
        setResolvedFileUrl(cachedBlobUrl || file.fileUrl);
      } else {
        setResolvedFileUrl(file.fileUrl);
        setOfflineMessage(null);
      }
    };

    void syncOfflineState();

    const handleConnectionChange = () => {
      setIsOnline(navigator.onLine);
      void syncOfflineState();
    };

    window.addEventListener("online", handleConnectionChange);
    window.addEventListener("offline", handleConnectionChange);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleConnectionChange);
      window.removeEventListener("offline", handleConnectionChange);
      if (cachedBlobUrlRef.current) {
        URL.revokeObjectURL(cachedBlobUrlRef.current);
        cachedBlobUrlRef.current = null;
      }
    };
  }, [file]);

  useEffect(() => {
    if (offlineMessage) return;

    if (file.fileType === "image") {
      detectQRCode(resolvedFileUrl);
    } else if (file.fileType === "pdf") {
      void renderPdfPreview(resolvedFileUrl);
    }
  }, [file.fileType, offlineMessage, resolvedFileUrl]);

  const cacheForOffline = async () => {
    setOfflineStatus("pending");
    setOfflineMessage(null);

    try {
      const cached = await cacheDocumentForOffline(file.fileUrl);
      setOfflineStatus(cached ? "available" : "failed");
      if (!cached && !navigator.onLine) {
        setOfflineMessage("This file is not available offline");
      }
    } catch {
      setOfflineStatus("failed");
    }
  };

  const offlineBadge = (() => {
    if (offlineStatus === "available") {
      return { label: "Available offline", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20" };
    }

    if (offlineStatus === "pending") {
      return { label: "Caching offline", tone: "bg-amber-500/15 text-amber-200 border-amber-400/20" };
    }

    if (offlineStatus === "failed") {
      return { label: "Failed to cache", tone: "bg-rose-500/15 text-rose-200 border-rose-400/20" };
    }

    return {
      label: isOnline ? "Not cached yet" : "Offline unavailable",
      tone: "bg-white/10 text-slate-200 border-white/10",
    };
  })();

  const handleSaveFocusArea = async () => {
    await setFileFocusArea(file.id, tempFocusArea);
    setIsSelectingArea(false);
    setZoomPosition("ai");
    setIsQrZoomed(true);
  };

  const handleSelectionStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isSelectingArea || !containerRef.current) return;
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) e.preventDefault();
    
    setIsDrawing(true);
    const rect = containerRef.current.getBoundingClientRect();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    
    setTempFocusArea({ x, y, width: 0, height: 0 });
  };

  const handleSelectionMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isSelectingArea || !isDrawing || !tempFocusArea || !containerRef.current) return;
    e.stopPropagation();
    if ('cancelable' in e && e.cancelable) e.preventDefault();
    
    const rect = containerRef.current.getBoundingClientRect();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const currentX = (clientX - rect.left) / rect.width;
    const currentY = (clientY - rect.top) / rect.height;
    
    setTempFocusArea({
      ...tempFocusArea,
      width: currentX - tempFocusArea.x,
      height: currentY - tempFocusArea.y
    });
  };

  const handleSelectionEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (isDrawing) {
      e.stopPropagation();
      setIsDrawing(false);
    }
  };

  const runAiDeepScan = async () => {
    setIsAiScanning(true);
    try {
      const imgToScan = pdfPreviewUrl || resolvedFileUrl;
      const res = await fetch("/api/detect-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUri: imgToScan })
      });
      const data = await res.json();
      if (data.regions && data.regions.length > 0) {
        setAiRegions(data.regions);
        // Automatically focus the first detected region
        setActiveAiRegion(0);
        setZoomPosition("ai");
        setIsQrZoomed(true);
      }
    } catch (err) {
      console.error("AI Scan failed:", err);
    } finally {
      setIsAiScanning(false);
    }
  };

  const renderPdfPreview = async (url: string) => {
    setIsRendering(true);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      const loadingTask = pdfjs.getDocument(url);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      
      const viewport = page.getViewport({ scale: 2.0 }); // High res for QR detection
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext: Parameters<typeof page.render>[0] = {
        canvasContext: context,
        viewport,
        canvas,
      };

      await page.render(renderContext).promise;
      
      const imgData = canvas.toDataURL("image/png");
      setPdfPreviewUrl(imgData);
      
      // Detect QR in the rendered PDF page
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) {
        setQrContent(code.data);
        const { topLeftCorner, bottomRightCorner } = code.location;
        setQrPos({
          x: (topLeftCorner.x + bottomRightCorner.x) / 2 / canvas.width,
          y: (topLeftCorner.y + bottomRightCorner.y) / 2 / canvas.height
        });
      }
    } catch (err) {
      console.error("PDF rendering error:", err);
    } finally {
      setIsRendering(false);
    }
  };

  const detectQRCode = (url: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      
      if (code) {
        setQrContent(code.data);
        const { topLeftCorner, bottomRightCorner } = code.location;
        setQrPos({
          x: (topLeftCorner.x + bottomRightCorner.x) / 2 / canvas.width,
          y: (topLeftCorner.y + bottomRightCorner.y) / 2 / canvas.height
        });
      }
    };
    img.src = url;
  };

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 100) {
      onClose();
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: activityTitle,
          text: `Reservation for ${activityTitle}`,
          url: file.fileUrl
        });
      } catch (err) {
        console.error("Share failed:", err);
      }
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 overflow-hidden"
      >
        {/* Background Gradients for depth */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-1/4 -left-1/4 size-[100%] bg-indigo-500/10 rounded-full blur-[120px]" />
          <div className="absolute -bottom-1/4 -right-1/4 size-[100%] bg-rose-500/10 rounded-full blur-[120px]" />
        </div>

        {/* Close Button (Top Right) */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 z-[110] size-12 rounded-full bg-white/10 flex items-center justify-center text-white backdrop-blur-md border border-white/10 hover:bg-white/20 transition-all"
        >
          <X size={24} />
        </button>

        {/* Swipe Indicator */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-white/20 rounded-full z-[110]" />

        <motion.div
          style={{ y, opacity, scale }}
          drag={isSelectingArea ? false : "y"}
          dragConstraints={{ top: 0, bottom: 500 }}
          onDragEnd={handleDragEnd}
          className="relative w-full max-w-md aspect-[3/5] md:aspect-[3/4]"
        >
          {/* THE CARD */}
          <div className="w-full h-full bg-slate-900 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl border border-white/5 relative group">
            
            {/* CARD HEADER */}
            <div className="p-8 pb-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Reservation</p>
                <h3 className="text-xl font-black text-white truncate w-48">{activityTitle}</h3>
                <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${offlineBadge.tone}`}>
                  {offlineBadge.label}
                </span>
              </div>
              <div className="size-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                {file.fileType === "pdf" ? <FileText size={24} /> : <QrCode size={24} />}
              </div>
            </div>

            {/* PREVIEW CONTENT */}
            <div 
              className="flex-1 relative p-4 flex items-center justify-center cursor-pointer overflow-hidden"
              onClick={() => {
                if (isSelectingArea) return; // Don't toggle zoom while selecting
                if (isQrZoomed) {
                  setIsQrZoomed(false);
                } else {
                  if (file.focusArea) {
                    setZoomPosition("ai");
                  } else {
                    setZoomPosition("center");
                  }
                  setIsQrZoomed(true);
                }
              }}
            >
              <div className="w-full h-full rounded-[2rem] overflow-hidden bg-black/40 flex items-center justify-center relative">
                {offlineMessage ? (
                  <div className="max-w-[18rem] space-y-3 px-6 text-center">
                    <p className="text-sm font-black text-white">{offlineMessage}</p>
                    <p className="text-xs font-medium text-slate-400">
                      Open it once while connected or use Download for offline before you travel.
                    </p>
                  </div>
                ) : isRendering || isAiScanning ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={32} className="text-indigo-500 animate-spin" />
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      {isAiScanning ? "AI Analyzing..." : "Optimizing PDF..."}
                    </p>
                  </div>
                ) : (
                  <div className="w-full h-full relative" ref={containerRef}>
                    {(() => {
                      const focus = tempFocusArea || file.focusArea;
                      const centerX = focus ? (focus.x + focus.width / 2) : 0.5;
                      const centerY = focus ? (focus.y + focus.height / 2) : 0.5;
                      const aiFocus = activeAiRegion !== null && aiRegions[activeAiRegion] 
                        ? { x: aiRegions[activeAiRegion].x / 100, y: aiRegions[activeAiRegion].y / 100 }
                        : null;
                      
                      const finalCenterX = zoomPosition === "ai" && focus ? centerX 
                        : zoomPosition === "ai" && aiFocus ? aiFocus.x
                        : zoomPosition === "qr" && qrPos ? qrPos.x
                        : 0.5;
                      
                      const finalCenterY = zoomPosition === "ai" && focus ? centerY 
                        : zoomPosition === "ai" && aiFocus ? aiFocus.y
                        : zoomPosition === "qr" && qrPos ? qrPos.y
                        : zoomPosition === "top" ? 0.1
                        : zoomPosition === "bottom" ? 0.9
                        : 0.5;

                      return (
                        <img 
                          src={pdfPreviewUrl || resolvedFileUrl} 
                          alt={file.fileName}
                          className={`max-w-full max-h-full object-contain transition-all duration-500 absolute inset-0 m-auto ${
                            isQrZoomed ? 'z-50' : 'z-0'
                          }`}
                          style={{
                            transform: isQrZoomed 
                              ? `scale(5) translate(${(0.5 - finalCenterX) * 100}%, ${(0.5 - finalCenterY) * 100}%)`
                              : 'scale(1) translate(0, 0)',
                            transformOrigin: 'center'
                          }}
                        />
                      );
                    })()}
                    
                    {/* Manual Selection Overlay */}
                    {isSelectingArea && (
                      <div 
                        className="absolute inset-0 z-20 touch-none cursor-crosshair overflow-hidden"
                        onMouseDown={handleSelectionStart}
                        onMouseMove={handleSelectionMove}
                        onMouseUp={handleSelectionEnd}
                        onMouseLeave={handleSelectionEnd}
                        onTouchStart={handleSelectionStart}
                        onTouchMove={handleSelectionMove}
                        onTouchEnd={handleSelectionEnd}
                      >
                        <div className="absolute inset-0 bg-black/60 pointer-events-none" />
                        {tempFocusArea && (
                          <div 
                            className="absolute border-2 border-indigo-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
                            style={{
                              left: `${tempFocusArea.x * 100}%`,
                              top: `${tempFocusArea.y * 100}%`,
                              width: `${tempFocusArea.width * 100}%`,
                              height: `${tempFocusArea.height * 100}%`,
                            }}
                          >
                            <div className="absolute -top-6 left-0 right-0 text-center">
                              <span className="bg-indigo-500 text-white text-[8px] font-black uppercase px-2 py-0.5 rounded-full">QR Area</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Focus Controls Overlay (Normal Mode) */}
                {!isQrZoomed && !isRendering && !isAiScanning && !isSelectingArea && (
                  <div className="absolute bottom-6 flex flex-wrap justify-center gap-2 px-4">
                    {file.focusArea ? (
                      <>
                        <motion.button
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          onClick={(e) => { e.stopPropagation(); setZoomPosition("ai"); setIsQrZoomed(true); }}
                          className="bg-indigo-500 hover:bg-indigo-600 border border-white/20 px-6 py-3 rounded-full flex items-center gap-2 text-white font-black text-xs transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] uppercase tracking-[0.15em]"
                        >
                          <QrCode size={16} /> Scan Focus
                        </motion.button>

                        <motion.button
                          onClick={(e) => { e.stopPropagation(); setIsSelectingArea(true); }}
                          className="bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/30 px-4 py-3 rounded-full flex items-center gap-2 text-white font-bold text-[10px] transition-all shadow-xl uppercase tracking-widest"
                        >
                          <Settings size={12} /> Edit
                        </motion.button>
                      </>
                    ) : (
                      <>
                        <motion.button
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          onClick={(e) => { e.stopPropagation(); runAiDeepScan(); }}
                          className="bg-indigo-500 hover:bg-indigo-600 border border-white/20 px-5 py-3 rounded-full flex items-center gap-2 text-white font-black text-[10px] transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] uppercase tracking-[0.15em]"
                        >
                          <Sparkles size={14} className="animate-pulse" /> AI Scan
                        </motion.button>

                        <motion.button
                          onClick={(e) => { e.stopPropagation(); setIsSelectingArea(true); }}
                          className="bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/30 px-4 py-3 rounded-full flex items-center gap-2 text-white font-bold text-[10px] transition-all shadow-xl uppercase tracking-widest"
                        >
                          <Maximize2 size={12} /> Set Focus
                        </motion.button>
                      </>
                    )}
                  </div>
                )}


                {/* AI Detected regions selector */}
                {isQrZoomed && aiRegions.length > 1 && (
                  <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-2 px-4 z-[160]">
                    {aiRegions.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={(e) => { e.stopPropagation(); setActiveAiRegion(idx); setZoomPosition("ai"); }}
                        className={`size-3 rounded-full border transition-all ${activeAiRegion === idx ? 'bg-white scale-125 border-white' : 'bg-white/20 border-white/40 hover:bg-white/40'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Selection Controls Footer (Selecting Mode) */}
            {isSelectingArea && (
              <div className="px-8 pb-8 flex justify-center gap-4 z-[30] bg-slate-900">
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsSelectingArea(false); }}
                  className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-black py-4 rounded-3xl transition-all uppercase tracking-widest text-[10px]"
                >
                  Cancel
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleSaveFocusArea(); }}
                  className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white font-black py-4 rounded-3xl transition-all shadow-lg shadow-indigo-500/30 uppercase tracking-widest text-[10px]"
                >
                  Save Area
                </button>
              </div>
            )}

            {/* CARD FOOTER / QR AREA */}
            {!isSelectingArea && (
              <div className="p-8 pt-0 space-y-6">
              {/* Fake Ticket Dots/Cuts */}
              <div className="flex items-center gap-2 py-4">
                <div className="flex-1 border-t border-dashed border-white/10" />
                <div className="size-4 rounded-full bg-black -ml-6" />
                <div className="size-4 rounded-full bg-black -mr-6" />
                <div className="flex-1 border-t border-dashed border-white/10" />
              </div>

              <div className="flex flex-col items-center gap-4">
                {qrContent ? (
                  <div className="bg-white p-4 rounded-3xl shadow-inner-lg">
                    {/* For now we just show the content or a re-generated QR if we had a lib, 
                        but we'll just show a "QR detected" message and rely on the zoomed image */}
                    <div className="size-32 bg-slate-100 rounded-2xl flex items-center justify-center border-2 border-slate-200">
                      <QrCode size={48} className="text-slate-900" />
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Scan code not detected</p>
                    <p className="text-xs text-slate-400">{offlineMessage ?? "Use full preview for scanning"}</p>
                  </div>
                )}
                
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                  {offlineStatus === "available" ? "Ready offline" : "Tap card to view original"}
                </p>
              </div>
            </div>
            )}
          </div>
        </motion.div>

        {/* BOTTOM ACTION BAR */}
        <motion.div 
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          className="absolute bottom-10 left-4 right-4 flex items-center justify-center gap-4 z-[110]"
        >
          <button
            onClick={() => {
              void openDocumentInNewTab(file.fileUrl);
            }}
            disabled={!isOnline && offlineStatus !== "available"}
            className="flex-1 h-14 bg-white text-black rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-100 active:scale-95 transition-all shadow-xl"
          >
            <ExternalLink size={18} /> {file.fileType === "pdf" ? "Open PDF" : "Open Original"}
          </button>

          <button
            onClick={() => {
              void cacheForOffline();
            }}
            disabled={!isOnline || offlineStatus === "pending"}
            className="h-14 rounded-2xl bg-white/10 px-4 font-black text-[10px] uppercase tracking-widest text-white backdrop-blur-md border border-white/10 transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              <Download size={16} />
              {offlineStatus === "available" ? "Offline ready" : "Download offline"}
            </span>
          </button>
          
          <button
            onClick={handleShare}
            className="size-14 bg-white/10 hover:bg-white/20 text-white rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/10 transition-all"
          >
            <Share size={20} />
          </button>
          
          {onDelete && (
            <button
              onClick={() => {
                if (confirm("Delete this attachment?")) {
                  onDelete();
                  onClose();
                }
              }}
              className="size-14 bg-rose-500/20 hover:bg-rose-500/30 text-rose-500 rounded-2xl flex items-center justify-center backdrop-blur-md border border-rose-500/20 transition-all"
            >
              <Trash2 size={20} />
            </button>
          )}
        </motion.div>

        {/* FULL SCREEN QR MODE */}
        <AnimatePresence>
          {isQrZoomed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[150] bg-black flex flex-col items-center justify-center p-8 overflow-hidden"
              onClick={() => setIsQrZoomed(false)}
            >
              <div className="w-full max-w-sm aspect-square bg-white rounded-[3rem] p-8 shadow-2xl flex items-center justify-center overflow-hidden relative">
                {(() => {
                  const focus = tempFocusArea || file.focusArea;
                  const centerX = focus ? (focus.x + focus.width / 2) : 0.5;
                  const centerY = focus ? (focus.y + focus.height / 2) : 0.5;
                  const aiFocus = activeAiRegion !== null && aiRegions[activeAiRegion] 
                    ? { x: aiRegions[activeAiRegion].x / 100, y: aiRegions[activeAiRegion].y / 100 }
                    : null;
                  
                  const finalCenterX = zoomPosition === "ai" && focus ? centerX 
                    : zoomPosition === "ai" && aiFocus ? aiFocus.x
                    : zoomPosition === "qr" && qrPos ? qrPos.x
                    : 0.5;
                  
                  const finalCenterY = zoomPosition === "ai" && focus ? centerY 
                    : zoomPosition === "ai" && aiFocus ? aiFocus.y
                    : zoomPosition === "qr" && qrPos ? qrPos.y
                    : zoomPosition === "top" ? 0.1
                    : zoomPosition === "bottom" ? 0.9
                    : 0.5;

                  return (
                    <img 
                      src={pdfPreviewUrl || resolvedFileUrl} 
                      alt="QR Zoom" 
                      className="w-full h-full object-contain transition-transform duration-300"
                      style={{
                        transform: `scale(5) translate(${(0.5 - finalCenterX) * 100}%, ${(0.5 - finalCenterY) * 100}%)`,
                        transformOrigin: "center"
                      }}
                    />
                  );
                })()}
              </div>
              
              <div className="mt-12 flex flex-col items-center gap-2">
                <p className="text-white font-black uppercase tracking-[0.3em] text-xs animate-pulse">
                  {zoomPosition === "qr" ? "QR Scan Focus" : zoomPosition === "top" ? "Barcode Focus" : "Ready for Scanning"}
                </p>
                <p className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">Tap to close</p>
              </div>

              <div className="absolute bottom-12 flex gap-4">
                <button 
                  onClick={(e) => { e.stopPropagation(); setZoomPosition("top"); }}
                  className={`px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${zoomPosition === "top" ? 'bg-white text-black border-white' : 'bg-white/10 text-white border-white/20'}`}
                >
                  Top
                </button>
                {qrPos && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setZoomPosition("qr"); }}
                    className={`px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${zoomPosition === "qr" ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white/10 text-white border-white/20'}`}
                  >
                    QR
                  </button>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); setZoomPosition("bottom"); }}
                  className={`px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${zoomPosition === "bottom" ? 'bg-white text-black border-white' : 'bg-white/10 text-white border-white/20'}`}
                >
                  Bottom
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
