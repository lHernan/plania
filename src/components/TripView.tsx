"use client";

// TripView — full itinerary UI rendered at /trips
// AuthInitializer handles routing here once activeTrip is ready.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Bot,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  CreditCard,
  FileText,
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  ExternalLink,
  Plane,
  Camera,
  ShoppingBag,
  Map as MapIcon,
  Info,
  Trash2,
  Mic,
  MicOff,
  Edit2,
  X,
  Loader2,
  User as UserIcon,
  LogOut,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Share2,
  Sun,
  Moon,
  Monitor,
  Compass,
  FileUp
} from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { buildTripMapUrl } from "@/lib/google-maps-links";
import { useAuthStore } from "@/store/use-auth-store";
import { AuthModal } from "@/components/AuthModal";
import { optimizeDay } from "@/lib/ai/optimizer";
import { parseItineraryText } from "@/lib/import/parse-itinerary";
import {
  Activity,
  ActivityCategory,
  ActivityFile,
  CriticalReservation,
  ShoppingAssistantResponse,
  ShoppingItem,
  ShoppingSuggestion,
  TripDay,
} from "@/lib/types";
import { cacheDocumentForOffline, getCachedDocumentAvailability, type DocumentOfflineStatus } from "@/lib/offline-documents";
import { toCurrency, getMidpointTime, addMinutes } from "@/lib/utils";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { useOfflineStore } from "@/store/use-offline-store";
import { TripSwitcher } from "@/components/TripSwitcher";
import { WalletPreviewModal } from "@/components/WalletPreviewModal";
import { ShareTripModal } from "@/components/ShareTripModal";
import { BookingImportModal } from "@/components/BookingImportModal";
import { ActivityCommentsModal } from "@/components/ActivityCommentsModal";
import { FloatingActions } from "@/components/FloatingActions";
import { ChatPanel } from "@/components/ChatPanel";
import { TravelContextEditor } from "@/components/TravelContextEditor";
import { ArrivalAssistant } from "@/components/ArrivalAssistant";
import { CityPaymentGuideCard } from "@/components/CityPaymentGuideCard";
import { CurrencyConverter } from "@/components/CurrencyConverter";
import { EmergencyInfoCard } from "@/components/EmergencyInfoCard";
import { PackingListCard } from "@/components/PackingListCard";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { useCelebration, type CelebrationEvent } from "@/hooks/use-celebration";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { CATEGORY_STYLES, SortableActivityCard } from "@/components/SortableActivityCard";
import { findNextPendingDayId, isDayComplete, isTripComplete } from "@/lib/trip-progress";
import dynamic from "next/dynamic";

const DayMapView = dynamic(() => import("@/components/DayMapView"), {
  ssr: false,
});

async function callShoppingAssistant(payload: Record<string, unknown>) {
  const response = await fetch("/api/shopping-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: "Shopping assistant failed" }));
    throw new Error(errorBody.error || "Shopping assistant failed");
  }

  return (await response.json()) as ShoppingAssistantResponse;
}

const EMPTY_SHOPPING_ITEMS: ShoppingItem[] = [];
const EMPTY_STRING_LIST: string[] = [];
const CITY_COUNTRY_MAP: Record<string, string> = {
  tokyo: "Japan",
  osaka: "Japan",
  kyoto: "Japan",
  nara: "Japan",
  sapporo: "Japan",
  fukuoka: "Japan",
  seoul: "South Korea",
  busan: "South Korea",
  incheon: "South Korea",
};

function shallowEqualShoppingUi(left: ShoppingAssistantResponse["ui"], right: ShoppingAssistantResponse["ui"]) {
  return (
    left.input_mode === right.input_mode &&
    left.input_placeholder === right.input_placeholder &&
    left.list_style === right.list_style &&
    left.show_suggestions_card === right.show_suggestions_card
  );
}

function resolveShoppingDayCountry(city: string, tripName?: string) {
  const normalizedCity = city.trim().toLowerCase();
  if (CITY_COUNTRY_MAP[normalizedCity]) return CITY_COUNTRY_MAP[normalizedCity];
  if (tripName?.includes("Japan")) return "Japan";
  if (tripName?.includes("Korea")) return "South Korea";
  return city;
}

function ActivityFilesSection({ 
  activityId, 
  files = [],
  onPreview
}: { 
  activityId: string; 
  files?: ActivityFile[];
  onPreview: (file: ActivityFile) => void;
}) {
  const { t } = useI18n();
  const uploadFile = useItineraryStore((s) => s.uploadActivityFile);
  const deleteFile = useItineraryStore((s) => s.deleteActivityFile);
  const loading = useItineraryStore((s) => s.loading);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [offlineStatuses, setOfflineStatuses] = useState<Record<string, DocumentOfflineStatus>>({});
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    let cancelled = false;

    const syncStatuses = async () => {
      const nextStatuses = await Promise.all(
        files.map(async (file) => [file.id, (await getCachedDocumentAvailability(file.fileUrl)) ? "available" : "unavailable"] as const)
      );

      if (cancelled) return;

      setOfflineStatuses((current) => {
        const updated: Record<string, DocumentOfflineStatus> = { ...current };
        for (const [fileId, status] of nextStatuses) {
          if (current[fileId] !== "pending") {
            updated[fileId] = status;
          }
        }
        return updated;
      });
    };

    void syncStatuses();

    const handleConnectionChange = () => {
      setIsOnline(navigator.onLine);
      void syncStatuses();
    };

    window.addEventListener("online", handleConnectionChange);
    window.addEventListener("offline", handleConnectionChange);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleConnectionChange);
      window.removeEventListener("offline", handleConnectionChange);
    };
  }, [files]);

  const handleOfflineDownload = async (file: ActivityFile) => {
    setOfflineStatuses((current) => ({ ...current, [file.id]: "pending" }));

    try {
      const cached = await cacheDocumentForOffline(file.fileUrl);
      setOfflineStatuses((current) => ({
        ...current,
        [file.id]: cached ? "available" : "failed",
      }));
    } catch {
      setOfflineStatuses((current) => ({ ...current, [file.id]: "failed" }));
    }
  };

  const handlePreview = (file: ActivityFile) => {
    if (offlineStatuses[file.id] !== "available" && isOnline) {
      void handleOfflineDownload(file);
    }

    onPreview(file);
  };

  const getOfflineBadgeCopy = (status: DocumentOfflineStatus) => {
    if (status === "available") return { label: t("offline_available"), tone: "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]" };
    if (status === "pending") return { label: t("offline_caching"), tone: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]" };
    if (status === "failed") return { label: t("offline_failed"), tone: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]" };
    return {
      label: isOnline ? t("offline_not_cached") : t("offline_unavailable"),
      tone: "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
    };
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    for (let i = 0; i < selectedFiles.length; i++) {
      await uploadFile(activityId, selectedFiles[i]);
    }
    // Clear input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] flex items-center gap-1">
          <FileText size={12} /> {t("attachments")}
        </label>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="text-[10px] font-black uppercase tracking-widest text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] disabled:opacity-50 flex items-center gap-1 bg-[var(--color-primary-subtle)] px-3 py-1 rounded-full transition-all"
        >
          <Plus size={12} /> {t("add_file")}
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          accept="image/*,.pdf"
          className="hidden"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {files.map((file) => (
          <div
            key={file.id}
            className="group relative bg-[var(--color-surface)] rounded-2xl p-3 border border-[var(--color-border)] border-[var(--color-border)] flex items-center gap-3 shadow-sm hover:shadow-md transition-all"
          >
            <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${
              file.fileType === "pdf" ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]" : "bg-[var(--color-transport)]/10 text-[var(--color-transport)]"
            }`}>
              {file.fileType === "pdf" ? <FileText size={20} /> : <Camera size={20} />}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-[var(--color-text)] truncate pr-6" title={file.fileName}>
                {file.fileName}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handlePreview(file)}
                  className="text-[10px] font-bold text-[var(--color-primary)] hover:underline uppercase tracking-wider"
                >
                  {t("view_file")}
                </button>
                <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${getOfflineBadgeCopy(offlineStatuses[file.id] ?? "unavailable").tone}`}>
                  {getOfflineBadgeCopy(offlineStatuses[file.id] ?? "unavailable").label}
                </span>
              </div>
            </div>

            <button
              onClick={() => handleOfflineDownload(file)}
              disabled={offlineStatuses[file.id] === "pending" || !isOnline}
              className="shrink-0 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-primary)]/30 hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {offlineStatuses[file.id] === "available" ? t("offline_ready_short") : t("download_offline")}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(t("confirm_delete_file"))) {
                  deleteFile(file.id);
                }
              }}
              className="absolute top-2 right-2 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        
        {files.length === 0 && !loading && (
          <div className="col-span-full py-6 text-center rounded-2xl border-2 border-dashed border-[var(--color-border)] border-[var(--color-border)]">
            <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
              {t("no_attachments_hint")}
            </p>
          </div>
        )}

        {loading && (
          <div className="col-span-full py-6 flex items-center justify-center">
            <Loader2 size={20} className="text-[var(--color-primary)] animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityEditModal({
  activity,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
  onPreviewFile
}: {
  activity: Activity;
  onClose: () => void;
  onSave: (updates: Partial<Activity>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onPreviewFile: (file: ActivityFile) => void;
}) {
  const { t } = useI18n();
  const [localTitle, setLocalTitle] = useState(activity.title);
  const [localTime, setLocalTime] = useState(activity.time);
  const [localDuration, setLocalDuration] = useState(activity.durationMin);
  const [localCategory, setLocalCategory] = useState<ActivityCategory>(activity.category);
  const [localCost, setLocalCost] = useState(activity.expectedCost || 0);
  const [localLocation, setLocalLocation] = useState(activity.location || "");
  const [localNotes, setLocalNotes] = useState(activity.notes || "");

  const categories = Object.keys(CATEGORY_STYLES) as ActivityCategory[];

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm"
      />
      
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-white dark:bg-[var(--color-bg)] rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col max-h-[85dvh] overflow-hidden"
      >
        <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-subtle)] transition-colors z-[60] hidden md:block"><X size={20} className="text-[var(--color-text-muted)]" /></button>
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-subtle)] transition-colors z-[60] md:hidden flex items-center justify-center shadow-lg"><X size={16} className="text-[var(--color-text-muted)]" /></button>
        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10 scrollbar-hide">
          <div className="flex justify-center mb-6 md:hidden">
            <div className="w-12 h-1.5 rounded-full bg-[var(--color-border)]" />
          </div>

          <div className="space-y-8">
            {/* Title & Category Row */}
            <div>
              <input
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                className="w-full bg-transparent text-2xl font-black text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none pb-2 border-b-2 border-transparent focus:border-[var(--color-primary)]/30 transition-all font-sans"
                placeholder={t("adventure_title_placeholder")}
              />
            </div>

            {/* Editable Category Pills */}
            <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide snap-x">
              {categories.map((cat) => {
                const isSel = localCategory === cat;
                const conf = CATEGORY_STYLES[cat];
                const Icon = conf.icon;
                return (
                  <button
                    key={cat}
                    onClick={() => setLocalCategory(cat)}
                    className={`snap-center flex items-center gap-2 px-4 py-2.5 rounded-full whitespace-nowrap transition-all border ${
                      isSel 
                        ? `${conf.bg} ${conf.color} border-transparent shadow-sm ring-2 ring-[var(--color-primary)]/20 ring-offset-2 ring-offset-white` 
                        : "bg-[var(--color-surface-subtle)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
                    }`}
                  >
                    <Icon size={14} strokeWidth={isSel ? 3 : 2} />
                    <span className="text-xs font-bold uppercase tracking-wider">{t(cat)}</span>
                  </button>
                );
              })}
            </div>

            {/* Time & Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><Clock3 size={12}/> {t("time")}</label>
                <input
                  type="time"
                  value={localTime}
                  onChange={(e) => setLocalTime(e.target.value)}
                  className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
                />
              </div>
              <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 block">{t("duration_mins")}</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={localDuration}
                    onChange={(e) => setLocalDuration(parseInt(e.target.value) || 0)}
                    className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
                  />
                  <span className="text-[10px] font-black text-[var(--color-text-muted)]">{t("mins_short")}</span>
                </div>
              </div>
            </div>

            {/* Location & Cost */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><MapPin size={12}/> {t("location")}</label>
                <input
                  type="text"
                  value={localLocation}
                  onChange={(e) => setLocalLocation(e.target.value)}
                  placeholder={t("location_placeholder")}
                  className="w-full bg-transparent text-sm font-bold border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
                />
              </div>
              <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><CreditCard size={12}/> {t("expected_cost")}</label>
                <div className="flex items-center gap-1">
                  <span className="text-xl font-black text-[var(--color-text-muted)]">$</span>
                  <input
                    type="number"
                    value={localCost}
                    onChange={(e) => setLocalCost(parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)] relative">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-3 flex items-center gap-1"><FileText size={12}/> {t("notes")}</label>

              <textarea
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                placeholder={t("notes_placeholder")}
                className="w-full bg-transparent text-sm font-medium border-none p-0 outline-none focus:ring-0 min-h-[120px] resize-none text-[var(--color-text)] leading-relaxed"
              />
            </div>

            {/* Attachments Section */}
            <ActivityFilesSection 
              activityId={activity.id} 
              files={activity.files} 
              onPreview={onPreviewFile}
            />
          </div>
        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="p-4 md:px-10 border-t border-[var(--color-border)] border-[var(--color-border)]/50 bg-[var(--color-surface-subtle)] dark:bg-[var(--color-bg)] flex gap-3 pb-safe">
           <button 
             onClick={() => { onDelete(); onClose(); }}
             className="size-14 shrink-0 rounded-[1.5rem] bg-[var(--color-danger)]/10 text-[var(--color-danger)] flex items-center justify-center hover:bg-[var(--color-danger)]/20 transition-colors"
           >
             <Trash2 size={20} />
           </button>
           <button 
             onClick={() => { onDuplicate(); onClose(); }}
             className="size-14 shrink-0 rounded-[1.5rem] bg-[var(--color-primary-subtle)] dark:bg-[var(--color-primary)]/20 text-[var(--color-primary)] items-center justify-center hover:bg-[var(--color-primary-subtle)] transition-colors hidden md:flex"
           >
             <Plus size={24} />
           </button>
           <button 
             onClick={() => {
                onSave({
                  title: localTitle,
                  time: localTime,
                  durationMin: localDuration,
                  category: localCategory,
                  expectedCost: localCost,
                  location: localLocation,
                  notes: localNotes
                });
                onClose();
             }}
             className="flex-1 rounded-[1.5rem] bg-[var(--color-text)] dark:bg-white text-white dark:text-[var(--color-text)] font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center hover:scale-[1.02] active:scale-[0.98] transition-transform"
           >
             {t("save_changes")}
           </button>
        </div>
      </motion.div>
    </div>
  );
}

function ReservationEditModal({
  reservation,
  onClose,
  onSave,
  onDelete,
  isNew = false
}: {
  reservation: Partial<CriticalReservation>;
  onClose: () => void;
  onSave: (updates: Partial<CriticalReservation>) => void;
  onDelete: () => void;
  isNew?: boolean;
}) {
  const { t } = useI18n();
  const [localTitle, setLocalTitle] = useState(reservation.title || "");
  const [localDate, setLocalDate] = useState(reservation.reservationDate || "");
  const [localDeadline, setLocalDeadline] = useState(reservation.bookingDeadline || "");
  const [localLink, setLocalLink] = useState(reservation.bookingLink || "");
  const [localPrice, setLocalPrice] = useState(reservation.price || 0);
  const [todayStr, setTodayStr] = useState("");

  useEffect(() => {
    setTodayStr(new Date().toISOString().split('T')[0]);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm"
      />
      
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white dark:bg-[var(--color-bg)] rounded-t-2xl md:rounded-2xl shadow-2xl flex flex-col max-h-[85dvh] overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10 scrollbar-hide">
          <div className="flex justify-center mb-6 md:hidden">
            <div className="w-12 h-1.5 rounded-full bg-[var(--color-border)]" />
          </div>

          <div className="space-y-6">
            <div>
              <input
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                className="w-full bg-transparent text-2xl font-black text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none pb-2 border-b-2 border-transparent focus:border-[var(--color-primary)]/30 transition-all font-sans"
                placeholder={t("reservation_title_placeholder")}
                autoFocus
              />
            </div>

            <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><CalendarDays size={12}/> {t("reservation_date")}</label>
              <input
                type="date"
                min={todayStr}
                value={localDate}
                onChange={(e) => setLocalDate(e.target.value)}
                onClick={(e) => (e.currentTarget as any).showPicker?.()}
                className="w-full bg-transparent text-lg font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><Clock3 size={12}/> {t("booking_deadline")}</label>
                <input
                  type="date"
                  min={todayStr}
                  value={localDeadline}
                  onChange={(e) => setLocalDeadline(e.target.value)}
                  onClick={(e) => (e.currentTarget as any).showPicker?.()}
                  className="w-full bg-transparent text-base font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
                />
              </div>

              <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
                <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><CreditCard size={12}/> {t("price")}</label>
                <div className="flex items-center gap-1">
                  <span className="text-xl font-black text-[var(--color-text-muted)]">$</span>
                  <input
                    type="number"
                    value={localPrice}
                    onChange={(e) => setLocalPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
                  />
                </div>
              </div>
            </div>

            <div className="bg-[var(--color-surface-subtle)] rounded-3xl p-5 border border-[var(--color-border)] border-[var(--color-border)]">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] mb-2 flex items-center gap-1"><ExternalLink size={12}/> {t("booking_link")}</label>
              <input
                type="url"
                value={localLink}
                onChange={(e) => setLocalLink(e.target.value)}
                placeholder="https://..."
                className="w-full bg-transparent text-sm font-bold border-none p-0 outline-none focus:ring-0 text-[var(--color-text)]"
              />
            </div>
          </div>
        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="p-4 md:px-10 border-t border-[var(--color-border)] border-[var(--color-border)]/50 bg-[var(--color-surface-subtle)] dark:bg-[var(--color-bg)] flex gap-3 pb-safe">
           {!isNew && (
             <button 
               onClick={() => { onDelete(); onClose(); }}
               className="size-14 shrink-0 rounded-[1.5rem] bg-[var(--color-danger)]/10 text-[var(--color-danger)] flex items-center justify-center hover:bg-[var(--color-danger)]/20 transition-colors"
             >
               <Trash2 size={20} />
             </button>
           )}
           <button 
             onClick={() => {
                onSave({
                  title: localTitle,
                  reservationDate: localDate,
                  bookingDeadline: localDeadline,
                  bookingLink: localLink,
                  price: localPrice
                });
             }}
             className="flex-1 rounded-[1.5rem] bg-[var(--color-text)] dark:bg-white text-white dark:text-[var(--color-text)] font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center hover:scale-[1.02] active:scale-[0.98] transition-transform"
           >
             {t("save_reservation")}
           </button>
        </div>
      </motion.div>
    </div>
  );
}



export function TripView() {
  const { lang, setLang, t } = useI18n();
  const dateFnsLocale = lang === "es" ? es : enUS;
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const {
    activeTrip,
    trips,
    activeDayId,
    setActiveDay,
    fetchActiveTrip,
    switchTrip,
    addActivity,
    reorderActivities,
    updateActivityState,
    addImportedActivities,
    dayScrollY,
    setDayScroll,
    toggleBooking,
    patchActivity,
    loading,
    error,
    removeActivity,
    duplicateActivity,
    addReservation,
    patchReservation,
    removeReservation,
    addShoppingItems,
    toggleShoppingItemStatus,
    updateShoppingItem,
    removeShoppingItem,
    ignoreShoppingSuggestion,
    isOptimizing,
    optimizeDay: runOptimizeDay,
    addTripDay,
    removeTripDay,
    updateTripDay,
    createTrip,
    deleteActivityFile,
    hasFetched,
    activeTripIsDraft,
    saveDraft
  } = useItineraryStore();

  const { user, signOut: authSignOut } = useAuthStore();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showBookingImport, setShowBookingImport] = useState(false);
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "system">("system");
  const [showTravelTools, setShowTravelTools] = useState(false);
  const [commentActivity, setCommentActivity] = useState<{ id: string; title: string } | null>(null);
  const [showMap, setShowMap] = useState(false);
  // Only one map instance is mounted: side panel on desktop, full-screen overlay on mobile.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isMobileMapOpen = showMap && !isDesktop;
  // Publishes the sticky header's real height (it wraps with the day strip) so sticky
  // panels below it, like the desktop map, size themselves instead of guessing offsets.
  const headerObserverRef = useRef<ResizeObserver | null>(null);
  const headerRef = useCallback((el: HTMLElement | null) => {
    headerObserverRef.current?.disconnect();
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () => document.documentElement.style.setProperty("--app-header-h", `${el.offsetHeight}px`);
    publish();
    headerObserverRef.current = new ResizeObserver(publish);
    headerObserverRef.current.observe(el);
  }, []);
  const [activeMapActivityId, setActiveMapActivityId] = useState<string | null>(null);
  const [mapAnchor, setMapAnchor] = useState<{ lat: number; lng: number } | null>(null);
  const [showMapCityPrompt, setShowMapCityPrompt] = useState(false);
  const [mapLocating, setMapLocating] = useState(false);
  const openMapAfterDayEditRef = useRef(false);
  const [travelContextOpen, setTravelContextOpen] = useState(false);
  const savingDraftRef = useRef(false);

  // Initialize theme from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("plania_theme") as "light" | "dark" | "system" | null;
    const mode = stored || "system";
    setThemeMode(mode);
    const html = document.documentElement;
    if (mode === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      html.classList.toggle("dark", prefersDark);
    } else {
      html.classList.toggle("dark", mode === "dark");
    }
  }, []);

  // Auto-save draft when user logs in
  useEffect(() => {
    if (activeTripIsDraft && user && !user.is_anonymous && !savingDraftRef.current) {
      savingDraftRef.current = true;
      void saveDraft().finally(() => { savingDraftRef.current = false; });
    }
  }, [activeTripIsDraft, user, saveDraft]);
  const isInvitee = Boolean(activeTrip && user && activeTrip.userId !== user.id);
  const sharedTrips = useItineraryStore((s) => s.sharedTrips);
  const sharedTripInfo = isInvitee ? sharedTrips.find((t) => t.id === activeTrip?.id) ?? null : null;

  const budgetSummary = useMemo(() => {
    if (!activeTrip) return { total: 0, perDay: [] as { date: string; total: number }[] };
    const perDay = activeTrip.days.map((day) => ({
      date: day.date,
      total: day.activities.reduce((sum, a) => sum + (a.expectedCost ?? 0), 0),
    }));
    const total = perDay.reduce((sum, d) => sum + d.total, 0);
    return { total, perDay };
  }, [activeTrip]);

  const tripMapUrl = useMemo(() => {
    if (!activeTrip) return null;
    const day = activeTrip.days.find((d) => d.id === activeDayId) ?? activeTrip.days[0];
    if (!day) return null;
    const locations = day.activities
      .map((a) => a.location)
      .filter(Boolean) as string[];
    return buildTripMapUrl(locations);
  }, [activeTrip, activeDayId]);
  const [showCompletedDays, setShowCompletedDays] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Booking import needs a signed-in owner: invitees never see it, guests and the sample trip sign in first.
  const canImportBookings = Boolean(activeTrip) && !isInvitee;
  const openBookingImport = () => {
    if (!user || user.is_anonymous) {
      setShowAuthModal(true);
      return;
    }
    setShowBookingImport(true);
  };

  const [celebrationEvent, setCelebrationEvent] = useState<CelebrationEvent | null>(null);
  const [justCompletedId, setJustCompletedId] = useState<string | null>(null);
  const { complete } = useCelebration();
  const dismissCelebration = useCallback(() => setCelebrationEvent(null), []);

  // Single entry point for list checkbox, swipe and map card, so both views stay in sync.
  const handleComplete = async (dayId: string, activityId: string) => {
    setJustCompletedId(activityId);
    const { ok, event } = await complete(dayId, activityId);
    if (!ok) {
      setJustCompletedId(null);
      showToast(t("activity_state_save_failed"), "error");
      return;
    }
    if (event) setCelebrationEvent(event);
  };

  const handleUncomplete = async (dayId: string, activityId: string) => {
    if (justCompletedId === activityId) setJustCompletedId(null);
    const ok = await updateActivityState(dayId, activityId, "pending");
    if (!ok) showToast(t("activity_state_save_failed"), "error");
  };

  const [showAdd, setShowAdd] = useState(false);
  // Same quick actions wherever they are docked (page corner or mobile map overlay).
  const floatingActionsProps = {
    onAdd: isInvitee ? undefined : () => setShowAdd(true),
    showAgent: Boolean(activeTrip),
  };
  const [showAddReservation, setShowAddReservation] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const editingActivity = useMemo(() => {
    if (!activeTrip || !editingActivityId) return null;
    for (const day of activeTrip.days) {
      const found = day.activities.find((a) => a.id === editingActivityId);
      if (found) return found;
    }
    return null;
  }, [activeTrip, editingActivityId]);
  const [editingReservation, setEditingReservation] = useState<CriticalReservation | null>(null);
  const [previewFile, setPreviewFile] = useState<ActivityFile | null>(null);
  const [slideDirection, setSlideDirection] = useState(1);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("09:00");
  const [newNotes, setNewNotes] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [editingDay, setEditingDay] = useState<TripDay | null>(null);
  const [editDayCity, setEditDayCity] = useState("");
  const [editDayLabel, setEditDayLabel] = useState("");
  const [shoppingInput, setShoppingInput] = useState("");
  const [shoppingSuggestions, setShoppingSuggestions] = useState<ShoppingSuggestion[]>([]);
  const [shoppingUi, setShoppingUi] = useState<ShoppingAssistantResponse["ui"]>({
    input_mode: "textbox",
    input_placeholder: "",
    list_style: "todo",
    show_suggestions_card: false,
  });
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [selectedShoppingItemId, setSelectedShoppingItemId] = useState<string | null>(null);
  const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<{ name: string; area: string | null }[]>([]);
  const [nearbyAttribution, setNearbyAttribution] = useState<string | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "preview" | "syncing">("idle");
  const [previewCountdown, setPreviewCountdown] = useState(0);
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const isOnline = useOfflineStore((s) => s.isOnline);

  const cancelVoice = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVoiceState("idle");
    setPreviewCountdown(0);
  };

  const handleImportSync = async (textToSync: string) => {
    if (!textToSync.trim() || isImporting) return;
    if (!isOnline) {
      showToast(t("trip_view_ai_import_offline"), "error");
      cancelVoice();
      return;
    }
    try {
      setIsImporting(true);
      if (voiceState === "preview") setVoiceState("syncing");
      
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSync,
          fallbackDate: activeDay?.date || new Date().toISOString(),
          lang,
        })
      });
      
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown server error" }));
        throw new Error(errBody.error || `Server error ${res.status}`);
      }
      
      const data = await res.json();
      if (data.activities && Array.isArray(data.activities)) {
        const newOnes = data.activities.map((a: any, i: number) => ({
          id: `ai-${Date.now()}-${i}`,
          title: a.title,
          category: a.category || "other",
          location: a.location || "",
          time: a.time || "12:00",
          durationMin: a.duration_minutes || 60,
          notes: a.notes || "",
          priority: "medium",
          state: "pending",
          sort_order: 999,
          city: "AI Imported",
          userId: user?.id || "",
          timeConfidence: a.time_confidence !== undefined ? a.time_confidence : 1.0,
          timeInferred: a.time_inferred !== undefined ? a.time_inferred : false
        }));

        await addImportedActivities(activeDayId, newOnes);
        setImportText("");
      }
    } catch (e) {
      console.error("Error with AI Import", e);
      alert(t("error_ai_import"));
    } finally {
      setIsImporting(false);
      setVoiceState("idle");
      setPreviewCountdown(0);
    }
  };

  const startListening = () => {
    if (!isSpeechSupported) return;
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = lang === 'es' ? 'es-ES' : 'en-US'; // Force matched language
      recognition.continuous = false;
      recognition.interimResults = true;
      
      recognition.onstart = () => {
        setVoiceState("listening");
        setImportText("");
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          finalTranscript += event.results[i][0].transcript;
        }
        setImportText(finalTranscript);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          recognition.stop();
        }, 1500);
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          alert(t("mic_denied"));
        } else {
          console.warn("Speech recognition error:", event.error);
        }
        cancelVoice();
      };

      recognition.onend = () => {
        setVoiceState(prev => {
          if (prev === "listening") {
            setPreviewCountdown(2);
            return "preview";
          }
          return prev;
        });
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.error("Failed to start speech recognition", err);
    }
  };

  useEffect(() => {
    if (voiceState === "preview" && previewCountdown > 0) {
      const timer = setTimeout(() => setPreviewCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    } else if (voiceState === "preview" && previewCountdown === 0) {
      handleImportSync(importText);
    }
  }, [voiceState, previewCountdown, importText]);

  const handleImportTextChange = (val: string) => {
    setImportText(val);
    if (voiceState === "preview") cancelVoice();
  };

  const [nowTs, setNowTs] = useState<number>(0);
  const [isMounted, setIsMounted] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const swipeStartX = useRef<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  useEffect(() => {
    console.log("Plania: Component mounted, isMounted:", isMounted);
    setIsMounted(true);
    setNowTs(Date.now());
    const interval = setInterval(() => setNowTs(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  // One-shot initial fetch: fires exactly once when the component mounts with a known user.
  // We use a ref (not hasFetched) so that subsequent switchTrip calls don't re-trigger this.
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (isMounted && user?.id && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchActiveTrip();
    }
  }, [isMounted, user?.id, fetchActiveTrip]);

  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = dayScrollY[activeDayId] ?? 0;
    }
  }, [activeDayId, dayScrollY]);

  const activeDay = useMemo(() =>
    activeTrip?.days.find(d => d.id === activeDayId) || activeTrip?.days[0],
    [activeTrip, activeDayId]
  );

  // Reset active map marker when switching days
  useEffect(() => { setActiveMapActivityId(null); }, [activeDayId]);

  const shoppingItems = activeTrip?.shoppingItems ?? EMPTY_SHOPPING_ITEMS;
  const ignoredSuggestionKeys = activeTrip?.ignoredShoppingSuggestionKeys ?? EMPTY_STRING_LIST;

  const completion = useMemo(() => {
    if (!activeTrip || !activeDay) return { tripPct: 0, dayPct: 0, cityPct: 0 };
    const all = activeTrip.days.flatMap((d) => d.activities);
    const done = all.filter((a) => a.state === "completed").length;
    const dayDone = activeDay.activities.filter((a) => a.state === "completed").length;
    const cityItems = all.filter((a) => a.city === activeDay.city);
    const cityDone = cityItems.filter((a) => a.state === "completed").length;
    return {
      tripPct: all.length ? Math.round((done / all.length) * 100) : 0,
      dayPct: activeDay.activities.length ? Math.round((dayDone / activeDay.activities.length) * 100) : 0,
      cityPct: cityItems.length ? Math.round((cityDone / cityItems.length) * 100) : 0,
    };
  }, [activeTrip, activeDay]);

  const suggestions = useMemo(() => activeDay ? optimizeDay(activeDay) : [], [activeDay]);
  const visibleShoppingSuggestions = useMemo(
    () =>
      selectedShoppingItemId
        ? shoppingSuggestions.filter((suggestion) => suggestion.shopping_item_id === selectedShoppingItemId)
        : shoppingSuggestions,
    [selectedShoppingItemId, shoppingSuggestions]
  );
  const sortedShoppingItems = useMemo(() => {
    const pending = shoppingItems.filter((item) => item.status === "pending");
    const purchased = shoppingItems.filter((item) => item.status !== "pending");
    return [...pending, ...purchased];
  }, [shoppingItems]);
  const shoppingCandidatePlaces = useMemo(
    () =>
      (activeDay?.activities ?? [])
        .filter((activity) => activity.location)
        .map((activity) => ({
          name: activity.location as string,
          area: activity.city || activeDay?.city || null,
        })),
    [activeDay]
  );
  const mergedCandidatePlaces = useMemo(() => {
    const merged = [...nearbyPlaces, ...shoppingCandidatePlaces];
    const seen = new Set<string>();
    return merged.filter((place) => {
      const key = `${place.name.toLowerCase()}|${(place.area ?? "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [nearbyPlaces, shoppingCandidatePlaces]);

  const sortedActivities = useMemo(() => {
    if (!activeDay) return [];
    const list = [...activeDay.activities];
    const pending = list
      .filter((a) => a.state !== "completed")
      .sort((a, b) => a.time.localeCompare(b.time));
    const completed = list
      .filter((a) => a.state === "completed")
      .sort((a, b) => a.time.localeCompare(b.time));
    return [...pending, ...completed];
  }, [activeDay]);

  const handleAddDay = async () => {
    if (!activeTrip) return;
    
    let nextDate = format(new Date(), "yyyy-MM-dd");
    if (activeTrip.days.length > 0) {
      const lastDay = activeTrip.days[activeTrip.days.length - 1];
      const dateObj = new Date(lastDay.date + "T00:00:00");
      dateObj.setDate(dateObj.getDate() + 1);
      nextDate = format(dateObj, "yyyy-MM-dd");
    }

    await addTripDay(nextDate, "New City", `Day ${activeTrip.days.length + 1}`);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || over.id === active.id || !activeDay) return;

    reorderActivities(activeDayId, String(active.id), String(over.id));

    const movedId = String(active.id);
    const dayActivities = activeDay.activities;
    const oldIndex = dayActivities.findIndex((a) => a.id === movedId);
    
    const currentOrder = sortedActivities;
    const overViewIndex = currentOrder.findIndex(a => a.id === over.id);

    let newTime = "";
    if (overViewIndex === 0) {
      newTime = addMinutes(currentOrder[1].time, -30);
    } else if (overViewIndex === currentOrder.length - 1) {
      newTime = addMinutes(currentOrder[currentOrder.length - 2].time, 30);
    } else {
      const prev = currentOrder[overViewIndex - 1];
      const next = currentOrder[overViewIndex];
      newTime = getMidpointTime(prev.time, next.time);
    }

    if (newTime) {
      patchActivity(activeDayId, movedId, { time: newTime });
    }
  };

  const activeIndex = activeTrip ? Math.max(0, activeTrip.days.findIndex((d) => d.id === activeDayId)) : 0;

  // Next real day with pending activities (skips empty and completed days).
  const nextPendingDayId = useMemo(
    () => (activeTrip ? findNextPendingDayId(activeTrip.days, activeDayId) : undefined),
    [activeTrip, activeDayId]
  );

  const goToDay = (dayId: string) => {
    if (!activeTrip) return;
    const targetIndex = activeTrip.days.findIndex((d) => d.id === dayId);
    setSlideDirection(targetIndex >= activeIndex ? 1 : -1);
    setCelebrationEvent(null);
    setActiveDay(dayId);
  };

  // Switching days never replays completion animations.
  useEffect(() => { setJustCompletedId(null); }, [activeDayId]);

  const handleSwipeEnd = (e: any, info: any) => {
    if (!activeTrip) return;
    const swipeThreshold = 50;
    if (info.offset.x < -swipeThreshold && activeIndex < activeTrip.days.length - 1) {
      setSlideDirection(1);
      setActiveDay(activeTrip.days[activeIndex + 1].id);
    } else if (info.offset.x > swipeThreshold && activeIndex > 0) {
      setSlideDirection(-1);
      setActiveDay(activeTrip.days[activeIndex - 1].id);
    }
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 100 : -100,
      opacity: 0,
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 100 : -100,
      opacity: 0,
    }),
  };

  const today = format(new Date(), "yyyy-MM-dd");

  const isTripCurrentlyActive = useMemo(() => {
    if (!activeTrip || !activeTrip.startDate || !activeTrip.endDate) return false;
    return activeTrip.startDate <= today && today <= activeTrip.endDate;
  }, [activeTrip, today]);

  const completedPastDays = useMemo(() => {
    if (!activeTrip || !isTripCurrentlyActive) return [];
    return activeTrip.days.filter((day) => {
      const isPast = day.date < today;
      if (!isPast) return false;
      return day.activities.every((a) => a.state === "completed");
    });
  }, [activeTrip, today, isTripCurrentlyActive]);

  const visibleDays = useMemo(() => {
    if (!activeTrip) return [];
    return activeTrip.days.filter((day) => {
      const isCompletedPast = completedPastDays.some((d) => d.id === day.id);
      if (isCompletedPast && !showCompletedDays && day.id !== activeDayId) {
        return false;
      }
      return true;
    });
  }, [activeTrip, completedPastDays, showCompletedDays, activeDayId]);
  const jumpToToday = () => {
    if (!activeTrip) return;
    const todayDay = activeTrip.days.find((day) => day.date === today);
    if (todayDay) {
      setActiveDay(todayDay.id);
    }
  };

  const nextActivity = (activeDay?.activities || [])
    .filter((item) => item.state !== "completed")
    .sort((a, b) => a.time.localeCompare(b.time))[0];
  const nextCountdown = nextActivity
    ? Math.max(
        0,
        Math.floor(
          (new Date(`${format(new Date(), "yyyy-MM-dd")}T${nextActivity.time}:00`).getTime() - nowTs) /
            60000,
        ),
      )
    : 0;

  useEffect(() => {
    const loadShoppingSuggestions = async () => {
      // During the initial load there may be no trip/day yet; do nothing to avoid render loops.
      if (!activeTrip || !activeDay) return;

      if (shoppingItems.filter((item) => item.status === "pending").length === 0) {
        setShoppingSuggestions((current) => (current.length ? [] : current));
        setShoppingUi((current) =>
          current.show_suggestions_card ? { ...current, show_suggestions_card: false } : current
        );
        return;
      }

      try {
        const result = await callShoppingAssistant({
          type: "suggestions",
          day: {
            date: activeDay.date,
            city: activeDay.city,
            country: resolveShoppingDayCountry(activeDay.city, activeTrip?.name),
          },
          itinerary: activeDay.activities,
          shopping_list: shoppingItems,
          candidate_places: mergedCandidatePlaces,
          ignored_suggestion_keys: ignoredSuggestionKeys,
        });
        setShoppingUi((current) => (shallowEqualShoppingUi(current, result.ui) ? current : result.ui));
        setShoppingSuggestions(result.suggestions);
      } catch {
        setShoppingSuggestions((current) => (current.length ? [] : current));
        setShoppingUi((current) =>
          current.show_suggestions_card ? { ...current, show_suggestions_card: false } : current
        );
      }
    };

    void loadShoppingSuggestions();
  }, [activeDay, activeTrip, activeTrip?.name, ignoredSuggestionKeys, mergedCandidatePlaces, shoppingItems]);

  const handleEnableDeviceLocation = async () => {
    if (!("geolocation" in navigator)) {
      showToast(t("map_location_not_supported"), "error");
      return;
    }

    setNearbyLoading(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60_000,
        });
      });

      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      setDeviceLocation({ lat, lon });

      const res = await fetch("/api/places/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat,
          lon,
          radius_m: 1800,
          limit: 12,
        }),
      });

      const data = (await res.json()) as {
        places?: { name: string; area: string | null }[];
        attribution?: string | null;
        warning?: string;
      };
      const places = Array.isArray(data.places) ? data.places : [];
      setNearbyPlaces(places);
      setNearbyAttribution(data.attribution ?? null);

      if (places.length > 0) {
        showToast(t("trip_view_nearby_shops_loaded"));
      } else if (data.warning) {
        showToast(t("trip_view_location_enabled_itinerary_context"));
      } else {
        showToast(t("trip_view_location_enabled_no_shops"));
      }
    } catch (error) {
      console.error("Unable to load nearby places", error);
      showToast(t("trip_view_nearby_places_failed"), "error");
    } finally {
      setNearbyLoading(false);
    }
  };

  const isPlaceholderCity = (city: string) => {
    const c = city.trim().toLowerCase();
    return !c || c === "new destination" || c === "new city";
  };

  const handleMapToggle = () => {
    if (showMap) {
      setShowMap(false);
      return;
    }
    if (activeDay && isPlaceholderCity(activeDay.city) && !mapAnchor) {
      setShowMapCityPrompt(true);
      return;
    }
    setShowMap(true);
  };

  const handleMapUseDeviceLocation = async () => {
    if (!("geolocation" in navigator)) {
      showToast(t("map_location_not_supported"), "error");
      return;
    }
    setMapLocating(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60_000,
        });
      });
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setMapAnchor({ lat, lng });

      // Reverse-geocode to fill in the city name
      if (activeDay) {
        try {
          const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = (await res.json()) as { city: string | null };
            if (data.city) {
              await updateTripDay(activeDay.id, { city: data.city });
            }
          }
        } catch {} // city update is best-effort
      }

      setShowMapCityPrompt(false);
      setShowMap(true);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("map_location_failed"),
        "error",
      );
    } finally {
      setMapLocating(false);
    }
  };

  const handleMapSetCityManually = () => {
    setShowMapCityPrompt(false);
    if (activeDay) {
      setEditingDay(activeDay);
      setEditDayCity(isPlaceholderCity(activeDay.city) ? "" : activeDay.city);
      setEditDayLabel(activeDay.label);
      openMapAfterDayEditRef.current = true;
    }
  };

  const handleAddShoppingItems = async () => {
    if (!shoppingInput.trim()) return;
    setShoppingLoading(true);
    try {
      const result = await callShoppingAssistant({
        type: "wishlist_input",
        text: shoppingInput,
        shopping_list: shoppingItems,
      });
      if (result.wishlist_items.length === 0) {
        showToast(t("trip_view_shopping_nothing_new"), "error");
      } else {
        await addShoppingItems(result.wishlist_items);
        setShoppingInput("");
        showToast(t("trip_view_shopping_list_updated"));
      }
      setShoppingUi(result.ui);
    } catch (error) {
      console.error("Shopping assistant failed", error);
      showToast(t("trip_view_shopping_assistant_failed"), "error");
    } finally {
      setShoppingLoading(false);
    }
  };

  const handleShoppingPlanAdd = async (suggestion: ShoppingSuggestion) => {
    if (!activeDay) return;
    const matchingItem = shoppingItems.find((item) => item.id === suggestion.shopping_item_id);
    if (!matchingItem) return;

    await addActivity({
      dayId: activeDayId,
      city: activeDay.city,
      title: suggestion.title,
      time: suggestion.suggested_time || "17:00",
      durationMin: suggestion.suggested_duration || 75,
      category: "shopping",
      priority: matchingItem.priority === "high" ? "high" : "medium",
      state: "pending",
      notes: suggestion.reason,
      location: suggestion.location_suggestions[0]?.name || activeDay.city,
      sort_order: 0,
    });
    showToast(t("trip_view_shopping_stop_added"));
  };

  const handleIgnoreShoppingSuggestion = async (suggestion: ShoppingSuggestion) => {
    const ignoreKey = suggestion.ui_hints?.ignore_key;
    if (!ignoreKey) return;
    await ignoreShoppingSuggestion(ignoreKey);
    setShoppingSuggestions((current) => current.filter((item) => item.ui_hints?.ignore_key !== ignoreKey));
  };

  if (!isMounted || (loading && !activeTrip)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-subtle)] dark:bg-[var(--color-bg)]">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-[var(--color-primary)]/20 border-t-[var(--color-primary)] rounded-full animate-spin" />
          <p className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest">{t("landing_loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-subtle)] dark:bg-[var(--color-bg)] p-8 text-center">
        <div className="premium-card p-12 max-w-md">
          <div className="size-16 bg-[var(--color-danger)]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Info className="text-[var(--color-danger)]" size={32} />
          </div>
          <h2 className="text-xl font-black text-[var(--color-text)] mb-2">{t("connection_issue")}</h2>
          <p className="text-[var(--color-text-secondary)] text-sm mb-8">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-[var(--color-text)] text-white rounded-2xl py-4 font-bold"
          >
            {t("retry_connection")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className={`min-h-screen bg-[var(--color-surface-subtle)] dark:bg-[var(--color-bg)] ${showMap && isDesktop ? "pb-0" : "pb-32"} ios-compact-shell`}>
      {/* One sticky stack for everything pinned to the top: the sample-trip notice and the
          header stack instead of both sticking at top-0 over each other. Its measured height
          (--app-header-h) includes the notice, so panels below offset correctly. */}
      <div ref={headerRef} className="sticky top-0 z-40 bg-[var(--color-surface)]/80 backdrop-blur-sm">
      {activeTripIsDraft && (
        <div className="bg-[var(--color-warning)]/10 border-b border-[var(--color-warning)]/20 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-[var(--color-warning)]">
            {t("trip_view_draft_banner")}
          </p>
          <button
            onClick={async () => {
              if (!user || user.is_anonymous) {
                setShowAuthModal(true);
                return;
              }
              const res = await saveDraft();
              if (res.error) alert(res.error);
            }}
            className="px-4 py-2 bg-[var(--color-warning)] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[var(--color-warning)]/90 transition-all min-h-[36px]"
          >
            {t("save")}
          </button>
        </div>
      )}
      {/* COMPACT STICKY HEADER */}
      <header className="border-b border-[var(--color-border)]">
        {/* Top bar: trip selector + controls */}
        <div className="flex items-center justify-between gap-3 px-4 h-14 md:h-16 max-w-7xl mx-auto ios-compact-header">
          {/* Left: Trip Switcher — the only part allowed to shrink, so the header never
              overflows narrow screens (an overflow widens the layout viewport and every
              fixed overlay with it, e.g. the mobile map). */}
          <div className="min-w-0 flex-1">
            <TripSwitcher />
          </div>

          {/* Right: user controls */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Theme toggle */}
            <button
              type="button"
              onClick={() => {
                const html = document.documentElement;
                const current = localStorage.getItem("plania_theme") || "system";
                const next = current === "light" ? "dark" : current === "dark" ? "system" : "light";
                localStorage.setItem("plania_theme", next);
                if (next === "system") {
                  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                  html.classList.toggle("dark", prefersDark);
                } else {
                  html.classList.toggle("dark", next === "dark");
                }
                setThemeMode(next as "light" | "dark" | "system");
              }}
              className="size-7 rounded-full bg-[var(--color-surface-subtle)] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              title={t("trip_view_theme", { mode: t(`trip_view_theme_${themeMode}`) })}
            >
              {themeMode === "light" ? <Sun size={14} /> : themeMode === "dark" ? <Moon size={14} /> : <Monitor size={14} />}
            </button>

            {/* Language toggle */}
            <div className="flex items-center rounded-full bg-[var(--color-surface-subtle)] p-0.5">
              {(["es", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-all ${
                    lang === code
                      ? "bg-[var(--color-primary)] text-white shadow-sm"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                  }`}
                >
                  {code === "es" ? "ES" : "EN"}
                </button>
              ))}
            </div>

            {user && !user.is_anonymous ? (
              <div className="flex items-center gap-1.5">
                {activeTrip && (
                  <div className="hidden sm:flex mr-2">
                    {isInvitee ? (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-accent-ai)]/10 text-[var(--color-accent-ai)] rounded-full border border-[var(--color-accent-ai)]/20" title={t("trip_view_read_only")}>
                        <Share2 size={10} />
                        <span className="text-[9px] font-black uppercase tracking-widest">
                          {t("trip_view_shared_by", { owner: sharedTripInfo?.ownerEmail || t("trip_view_owner_fallback") })}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowShareModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[var(--color-primary-subtle)] text-[var(--color-primary)] rounded-full transition-colors border border-transparent hover:border-[var(--color-primary)]/20"
                      >
                        <Share2 size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-widest hidden md:inline">{t("trip_view_share")}</span>
                      </button>
                    )}
                  </div>
                )}
                <div className="size-7 rounded-full bg-[var(--color-primary-subtle)] flex items-center justify-center text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                  <UserIcon size={12} />
                </div>
                <button
                  onClick={() => authSignOut()}
                  className="size-7 rounded-full bg-[var(--color-surface-subtle)] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors"
                >
                  <LogOut size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-primary)] text-white text-[9px] font-black uppercase tracking-widest hover:bg-[var(--color-primary-hover)] transition-all shadow-md shadow-[var(--color-primary)]/20"
              >
                <ShieldCheck size={10} />
                <span>{t("save")}</span>
              </button>
            )}
          </div>
        </div>

        {/* Date strip */}
        <div className="flex gap-2 overflow-x-auto pb-2 pt-1 px-4 scrollbar-hide snap-x max-w-7xl mx-auto ios-compact-gap">
          {completedPastDays.length > 0 && (
            <button
              onClick={() => setShowCompletedDays(!showCompletedDays)}
              className={`snap-center flex flex-col items-center justify-center min-w-[58px] h-[62px] py-1.5 px-2 rounded-2xl border transition-colors duration-150 flex-shrink-0 gap-1 select-none ${
                showCompletedDays
                  ? "bg-[var(--color-primary-subtle)] border-[var(--color-primary)]/20 text-[var(--color-primary)]"
                  : "bg-[var(--color-surface-subtle)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-primary-subtle)]"
              }`}
            >
              {showCompletedDays ? <EyeOff size={16} /> : <Eye size={16} />}
              <span className="text-[7px] font-black uppercase tracking-wider text-center leading-none">
                {showCompletedDays ? t("hide_past_days") : t("show_past_days")}
              </span>
              {completedPastDays.length > 0 && !showCompletedDays && (
                <span className="text-[8px] font-black leading-none bg-[var(--color-border)] text-[var(--color-text-secondary)] px-1 py-0.5 rounded-md">
                  {completedPastDays.length}
                </span>
              )}
            </button>
          )}

          {visibleDays.map((day) => {
            const isActive = day.id === activeDayId;
            const isToday = day.date === today;
            return (
              <button
                key={day.id}
                onClick={() => setActiveDay(day.id)}
                className={`snap-center flex flex-col items-center min-w-[52px] py-2.5 px-1.5 rounded-2xl transition-colors duration-150 relative border flex-shrink-0 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 focus-visible:ring-offset-2 ${
                  isActive
                    ? "bg-[#246B57] text-white border-[#246B57]"
                    : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-primary-subtle)]"
                }`}
              >
                <span className={`text-[9px] font-black uppercase tracking-wider mb-0.5 ${isActive ? "text-white/70" : "text-[var(--color-text-muted)]"}`}>
                  {format(day.date, "EEE", { locale: dateFnsLocale })}
                </span>
                <span className="text-base font-black tracking-tight leading-none">
                  {format(day.date, "d", { locale: dateFnsLocale })}
                </span>
                {isToday && !isActive && (
                  <div className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--color-primary)]" />
                )}
                {isActive && (
                  <div className="absolute -bottom-0.5 size-1 bg-white rounded-full" />
                )}
              </button>
            );
          })}

          {!isInvitee && (
            <button
              onClick={handleAddDay}
              className="snap-center flex flex-col items-center justify-center min-w-[52px] h-[62px] py-2 px-1.5 rounded-2xl border-2 border-dashed border-[var(--color-primary)]/30 text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)] transition-colors flex-shrink-0"
            >
              <Plus size={18} />
              <span className="text-[7px] font-black uppercase tracking-widest mt-0.5">{t("trip_view_day")}</span>
            </button>
          )}
        </div>
      </header>
      </div>

      {/* Day Summary Bar */}
      {activeDay && (
        <div className="max-w-7xl mx-auto px-5 pt-3">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin size={14} className="text-[var(--color-text-muted)] shrink-0" />
              <span className="text-sm font-bold text-[var(--color-text)] truncate">
                {format(activeDay.date, "EEE, MMM d", { locale: dateFnsLocale })}
              </span>
              <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider truncate">{activeDay.city}</span>
            </div>
            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
              {t(activeDay.activities.length === 1 ? "trip_view_activity_count_one" : "trip_view_activity_count_other", { count: activeDay.activities.length })}
            </span>
            <div className="flex items-center gap-2 flex-1 min-w-[80px] max-w-[160px]">
              <div className="flex-1 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${completion.dayPct}%` }}
                  className="h-full bg-[var(--color-primary)] rounded-full"
                />
              </div>
              <span className="text-[10px] font-black text-[var(--color-text-secondary)] tabular-nums">{completion.dayPct}%</span>
            </div>
            {activeDay.activities.some(a => a.expectedCost) && (
              <span className="text-xs font-bold text-[var(--color-text-secondary)] tabular-nums">
                {toCurrency(activeDay.activities.reduce((sum, a) => sum + (a.expectedCost ?? 0), 0))}
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {!isInvitee && (
                <>
                  <button
                    onClick={() => setShowAdd(true)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[var(--color-primary)] text-white text-[10px] font-bold uppercase tracking-wider hover:bg-[var(--color-primary-hover)] transition-colors"
                  >
                    <Plus size={12} /> {t("trip_view_add")}
                  </button>
                  <button
                    onClick={() => runOptimizeDay(activeDayId, lang)}
                    disabled={isOptimizing}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[var(--color-accent-ai)]/10 text-[var(--color-accent-ai)] text-[10px] font-bold uppercase tracking-wider hover:bg-[var(--color-accent-ai)]/20 transition-colors disabled:opacity-50"
                  >
                    {isOptimizing ? <div className="size-3 border-2 border-[var(--color-accent-ai)]/20 border-t-[var(--color-accent-ai)] rounded-full animate-spin" /> : <Sparkles size={12} />}
                    {t("day_genius")}
                  </button>
                  <button
                    onClick={handleMapToggle}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      showMap
                        ? "bg-[var(--color-primary)] text-white"
                        : "bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)]"
                    }`}
                  >
                    <MapIcon size={12} /> {t("map")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`max-w-7xl mx-auto px-5 pt-8 grid grid-cols-1 ${showMap ? "lg:grid-cols-[1fr_1fr]" : "lg:grid-cols-[1fr_340px]"} gap-10 ios-compact-gap`}>
        {/* ­ƒò░´©Å MAIN TIMELINE FLOW */}
        <div className="space-y-8">
          {/* DAY INTRO */}
          {activeDay ? (
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-1">
                <h2 className="text-xl font-black text-[var(--color-text)]">
                  {format(activeDay.date, "EEEE, MMM d", { locale: dateFnsLocale })}
                </h2>
                <div className="flex items-center gap-2">
                  <MapPin size={12} className="text-[var(--color-text-muted)]" />
                  <p className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">{activeDay.city}</p>
                  {!isInvitee && (
                    <button
                      onClick={() => {
                        setEditingDay(activeDay);
                        setEditDayCity(activeDay.city);
                        setEditDayLabel(activeDay.label);
                      }}
                      className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
                    >
                      <Edit2 size={10} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isInvitee && (
                  <button
                    onClick={() => {
                      if (confirm(t("trip_view_confirm_delete_day"))) {
                        removeTripDay(activeDayId);
                      }
                    }}
                    className="size-8 rounded-xl bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] flex items-center justify-center transition-all border border-[var(--color-border)]"
                    title={t("trip_view_remove_day")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  onClick={jumpToToday}
                  className="px-4 py-2 rounded-2xl bg-[var(--color-primary-subtle)] text-[var(--color-primary)] text-[10px] font-black uppercase tracking-widest hover:bg-[var(--color-primary-subtle)]/80 transition-all"
                >
                  {t("today")}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-[3rem] border-2 border-dashed border-[var(--color-border)] text-center space-y-4">
              <div className="size-16 bg-[var(--color-surface-subtle)] rounded-3xl flex items-center justify-center mx-auto text-[var(--color-text-muted)]">
                <CalendarDays size={32} />
              </div>
              <div>
                <h3 className="text-lg font-black text-[var(--color-text)]">{t("trip_view_no_days_found")}</h3>
                <p className="text-sm text-[var(--color-text-muted)]">{t("trip_view_no_days_hint")}</p>
              </div>
              <button
                onClick={handleAddDay}
                className="px-6 py-3 rounded-2xl bg-[var(--color-primary)] text-white font-bold text-sm shadow-lg shadow-[var(--color-primary)]/20"
              >
                {t("trip_view_add_first_day")}
              </button>
            </div>
          )}

          {shoppingUi.show_suggestions_card && visibleShoppingSuggestions.length > 0 && (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--color-primary)]">{t("trip_view_shopping_opportunity_today")}</p>
                  <h3 className="mt-2 text-lg font-black text-[var(--color-text)]">
                    {visibleShoppingSuggestions[0].title}
                  </h3>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    {visibleShoppingSuggestions[0].reason}
                  </p>
                  {visibleShoppingSuggestions[0].location_suggestions[0] && (
                    <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                      {visibleShoppingSuggestions[0].location_suggestions[0].name}
                      {visibleShoppingSuggestions[0].location_suggestions[0].area ? ` · ${visibleShoppingSuggestions[0].location_suggestions[0].area}` : ""}
                    </p>
                  )}
                </div>
                <ShoppingBag className="shrink-0 text-[var(--color-primary)]" size={28} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => void handleShoppingPlanAdd(visibleShoppingSuggestions[0])}
                  className="rounded-2xl bg-[var(--color-primary)] px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-[var(--color-primary)]/20"
                >
                  {t("trip_view_add_to_plan")}
                </button>
                <button
                  onClick={() => void handleIgnoreShoppingSuggestion(visibleShoppingSuggestions[0])}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--color-text-secondary)]"
                >
                  {t("trip_view_ignore")}
                </button>
              </div>
            </div>
          )}

          <DndContext id="itinerary-dnd" sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext
              items={sortedActivities.map((a) => a.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-10 relative">
                {/* Visual Timeline Line */}
                <div className="absolute left-[38px] top-6 bottom-6 w-0.5 bg-[var(--color-border)] hidden md:block" />

                <AnimatePresence mode="wait" custom={slideDirection} initial={false}>
                  <motion.div
                    key={activeDayId}
                    custom={slideDirection}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.2}
                    onDragEnd={handleSwipeEnd}
                    className="space-y-6 cursor-grab active:cursor-grabbing md:cursor-auto"
                  >
                    {/* DAY / TRIP COMPLETED — persistent, static state (celebration animation lives in CelebrationOverlay) */}
                    {activeDay && isDayComplete(activeDay) && (
                      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-primary-subtle)] bg-[var(--color-surface)] p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                        <span className="absolute inset-x-0 top-0 h-1 bg-[var(--color-celebration)]" aria-hidden="true" />
                        <div className="size-10 shrink-0 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center">
                          <Check size={20} strokeWidth={3} aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-[180px]">
                          <p className="text-base font-black tracking-tight text-[var(--color-text)]">
                            {activeTrip && isTripComplete(activeTrip) ? t("tachao_trip") : t("tachao_day")}
                          </p>
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            {activeTrip && isTripComplete(activeTrip) ? t("tachao_trip_sub") : t("tachao_day_sub")}
                          </p>
                        </div>
                        {nextPendingDayId && (
                          <button
                            type="button"
                            onClick={() => goToDay(nextPendingDayId)}
                            className="min-h-10 px-4 rounded-xl bg-[var(--color-primary)] text-white text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-colors"
                          >
                            {t("tachao_day_next")}
                          </button>
                        )}
                      </div>
                    )}

                    {/* SCHEDULED SECTION */}
                    {sortedActivities.some(a => a.state !== "completed") && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 ml-2">
                           <div className="size-2 rounded-full bg-[var(--color-primary)]" />
                           <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--color-text-secondary)]">{t("scheduled_adventure")}</h3>
                        </div>
                        <div className="space-y-4">
                          {sortedActivities
                            .filter((a) => a.state !== "completed")
                            .map((activity) => (
                               <SortableActivityCard
                                 key={activity.id}
                                 activity={activity}
                                 onComplete={(id) => handleComplete(activeDayId, id)}
                                 onUncomplete={(id) => handleUncomplete(activeDayId, id)}
                                 onEdit={() => setEditingActivityId(activity.id)}
                                 onComment={() => setCommentActivity({ id: activity.id, title: activity.title })}
                               />
                             ))}
                         </div>
                       </div>
                     )}

                     {/* COMPLETED SECTION */}
                    {sortedActivities.some(a => a.state === "completed") && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 ml-2">
                           <div className="size-2 rounded-full bg-[var(--color-primary)]/50" />
                           <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--color-text-secondary)]">{t("memory_lane")}</h3>
                        </div>
                        <div className="space-y-3">
                          {sortedActivities
                            .filter((a) => a.state === "completed")
                            .map((activity) => (
                               <SortableActivityCard
                                 key={activity.id}
                                 activity={activity}
                                 justCompleted={activity.id === justCompletedId}
                                 onComplete={(id) => handleComplete(activeDayId, id)}
                                 onUncomplete={(id) => handleUncomplete(activeDayId, id)}
                                 onEdit={() => setEditingActivityId(activity.id)}
                                 onComment={() => setCommentActivity({ id: activity.id, title: activity.title })}
                               />
                           ))}
                         </div>
                       </div>
                     )}

                     {sortedActivities.length === 0 && (
                      <div className="py-24 text-center">
                        <div className="size-24 bg-[var(--color-surface)] border-2 border-dashed border-[var(--color-border)] rounded-[3rem] flex items-center justify-center mx-auto mb-8 transition-transform hover:scale-110">
                          <Plane className="text-[var(--color-text-muted)]" size={40} />
                        </div>
                        <h3 className="text-xl font-black text-[var(--color-text)]">
                          {t("where_to_first")}
                        </h3>
                        <p className="text-[var(--color-text-secondary)] text-sm max-w-[240px] mx-auto mt-2 leading-relaxed">
                          {t("empty_itinerary_hint")}
                        </p>
                        {canImportBookings && (
                          <div className="mt-6 space-y-2">
                            <p className="text-[var(--color-text-secondary)] text-xs max-w-[280px] mx-auto leading-relaxed">
                              {t("booking_import_empty_day_hint")}
                            </p>
                            <button
                              onClick={openBookingImport}
                              className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl border border-[var(--color-primary)]/30 text-[var(--color-primary)] text-xs font-bold hover:bg-[var(--color-primary-subtle)] transition-colors"
                            >
                              <FileUp size={16} />
                              {t("booking_import_action")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* SIDEBAR / MAP */}
        {showMap && activeDay && isDesktop ? (
          // The grid item stretches with the row and owns the bottom spacing, so the sticky
          // panel can stay pinned through the whole scroll range (a sticky element never
          // leaves its grid area; page padding outside the grid would push it under the header).
          <div className="hidden lg:block">
          <div className="sticky top-[calc(var(--app-header-h,8.75rem)+1rem)] h-[calc(100dvh-var(--app-header-h,8.75rem)-2rem)]">
            <DayMapView
              dayId={activeDay.id}
              activities={activeDay.activities}
              city={activeDay.city}
              anchor={mapAnchor ?? undefined}
              activeActivityId={activeMapActivityId}
              canEdit={!isInvitee}
              preferMinimizeWalking={activeTrip?.travelContext?.preferences?.minimizeWalking}
              onActivitySelect={(id) => {
                setActiveMapActivityId(id);
                if (id) document.getElementById(`activity-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              onToggleComplete={(id, done) => (done ? handleComplete(activeDay.id, id) : handleUncomplete(activeDay.id, id))}
              onOpenDetails={(id) => setEditingActivityId(id)}
              onClose={() => setShowMap(false)}
            />
          </div>
          <div aria-hidden="true" className="h-32" />
          </div>
        ) : (
        <aside className="space-y-6">
          {/* AI QUICK ACTIONS */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("trip_view_ai_quick_actions")}</h3>
            <div className="space-y-3">
              <button
                onClick={() => runOptimizeDay(activeDayId, lang)}
                disabled={isOptimizing || isInvitee}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--color-accent-ai)]/10 text-[var(--color-accent-ai)] text-xs font-bold hover:bg-[var(--color-accent-ai)]/20 transition-colors disabled:opacity-50"
              >
                {isOptimizing ? <div className="size-4 border-2 border-[var(--color-accent-ai)]/20 border-t-[var(--color-accent-ai)] rounded-full animate-spin" /> : <Sparkles size={16} />}
                {t("day_genius")} — {t("ai_route_optimization")}
              </button>
              <button
                onClick={() => setTravelContextOpen(true)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] text-xs font-bold hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)] transition-colors"
              >
                <Compass size={16} />
                {t("trip_context")}
              </button>
              {canImportBookings && (
                <button
                  onClick={openBookingImport}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--color-primary-subtle)] text-[var(--color-primary)] text-xs font-bold hover:bg-[var(--color-primary)]/15 transition-colors"
                >
                  <FileUp size={16} />
                  {t("booking_import_action")}
                </button>
              )}
              <div className="relative">
                <textarea
                  value={importText}
                  onChange={(e) => handleImportTextChange(e.target.value)}
                  placeholder={t("paste_notes")}
                  className={`w-full h-28 bg-[var(--color-surface-subtle)] border ${voiceState === 'listening' ? 'border-[var(--color-danger)] ring-4 ring-[var(--color-danger)]/10' : 'border-[var(--color-border)]'} rounded-xl p-4 text-sm font-medium focus:ring-4 focus:ring-[var(--color-primary)]/10 transition-all resize-none outline-none`}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                  {voiceState === "preview" && (
                    <div className="flex items-center gap-2 bg-[var(--color-text)] text-[var(--color-surface)] px-3 py-1.5 rounded-full shadow-lg">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">{t("syncing_in", { seconds: previewCountdown })}</span>
                      <button onClick={cancelVoice} className="hover:opacity-70 p-0.5 rounded-full transition-colors">
                        <X size={12} />
                      </button>
                      <button onClick={cancelVoice} className="hover:opacity-70 p-0.5 rounded-full transition-colors ml-1" title={t("edit_manually")}>
                        <Edit2 size={12} />
                      </button>
                    </div>
                  )}
                  {isSpeechSupported && voiceState === "idle" && (
                    <button onClick={startListening} className="p-2 rounded-full bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)] transition-all">
                      <Mic size={18} />
                    </button>
                  )}
                  {voiceState === "listening" && (
                    <button onClick={cancelVoice} className="p-2 rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] animate-pulse transition-all">
                      <Mic size={18} />
                    </button>
                  )}
                  {voiceState === "syncing" && (
                    <Loader2 size={20} className="text-[var(--color-primary)] animate-spin" />
                  )}
                  {voiceState === "idle" && !isSpeechSupported && (
                    <Bot className="text-[var(--color-text-muted)]" size={20} />
                  )}
                </div>
              </div>
              <button
                className={`w-full rounded-xl px-4 py-3 text-xs font-bold transition-all tracking-wider uppercase disabled:opacity-60 ${
                  isImporting || voiceState === 'syncing'
                    ? "bg-[var(--color-text-muted)] text-[var(--color-surface)] cursor-wait"
                    : "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed"
                }`}
                disabled={isImporting || voiceState === 'syncing' || !importText.trim()}
                onClick={() => handleImportSync(importText)}
              >
                {isImporting || voiceState === 'syncing' ? t("processing_magic") : t("sync_to_timeline")}
              </button>
            </div>

            {suggestions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                {suggestions.map((s) => (
                  <div key={s.id} className="flex gap-3 p-3 rounded-xl bg-[var(--color-surface-subtle)] border border-[var(--color-border)]">
                    <div className="size-7 rounded-lg bg-[var(--color-accent-ai)]/10 flex items-center justify-center text-[var(--color-accent-ai)] shrink-0">
                      <Sparkles size={14} />
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-bold text-[var(--color-text)] tracking-tight">{s.title}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)] font-medium leading-relaxed">{s.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CRITICAL RESERVATIONS */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("critical_reservations")}</h3>
              <button
                onClick={() => setShowAddReservation(true)}
                className="size-7 rounded-lg bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)] flex items-center justify-center transition-all"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="space-y-3">
              {(activeTrip?.criticalReservations.length === 0) && (
                <div className="flex flex-col items-center gap-2 py-6 text-[var(--color-text-muted)]">
                  <CalendarDays size={24} />
                  <p className="text-xs font-medium">{t("no_reservations_yet")}</p>
                </div>
              )}
              {(activeTrip?.criticalReservations ?? []).map((booking) => {
                const isBooked = booking.status === "booked";
                return (
                  <div
                    key={booking.id}
                    onClick={() => setEditingReservation(booking)}
                    className={`rounded-xl p-4 transition-all border-l-4 cursor-pointer ${
                      isBooked
                        ? "bg-[var(--color-surface-subtle)] border-l-[var(--color-border-strong)] opacity-50"
                        : "bg-[var(--color-surface)] border border-[var(--color-border)] border-l-[var(--color-danger)] hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            isBooked ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]" : "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                          }`}>
                            {t(booking.status)}
                          </span>
                          {booking.urgency === "today" && !isBooked && (
                            <span className="text-[8px] font-black text-[var(--color-danger)] animate-pulse">{t("critical")}</span>
                          )}
                        </div>
                        <h4 className={`text-sm font-black transition-colors ${isBooked ? "text-[var(--color-text-muted)] line-through" : "text-[var(--color-text)]"}`}>
                          {booking.title}
                        </h4>
                        <p className="text-[10px] font-medium text-[var(--color-text-muted)]">
                          {booking.reservationDate}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isBooked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleBooking(booking.id)}
                        className="size-5 rounded border-2 border-[var(--color-border-strong)] checked:bg-[var(--color-primary)] checked:border-[var(--color-primary)] transition-all cursor-pointer accent-[var(--color-primary)]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SHOPPING LIST */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("trip_view_shopping_list")}</h3>
              <span className="rounded-full bg-[var(--color-surface-subtle)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--color-text-muted)]">
                {sortedShoppingItems.length}
              </span>
            </div>

            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={shoppingInput}
                  onChange={(e) => setShoppingInput(e.target.value)}
                  placeholder={shoppingUi.input_placeholder || t("trip_view_shopping_input_placeholder")}
                  className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
                <button
                  onClick={() => void handleAddShoppingItems()}
                  disabled={shoppingLoading || !shoppingInput.trim()}
                  className="rounded-xl bg-[var(--color-primary)] px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50"
                >
                  {shoppingLoading ? "..." : t("trip_view_add")}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => void handleEnableDeviceLocation()}
                  disabled={nearbyLoading}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-primary)]/30 hover:text-[var(--color-primary)] disabled:opacity-50"
                >
                  {nearbyLoading ? t("map_locating") : deviceLocation ? t("trip_view_refresh_nearby") : t("map_use_my_location")}
                </button>
                {nearbyAttribution && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                    {nearbyAttribution}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {sortedShoppingItems.length === 0 && (
                  <div className="rounded-xl border-2 border-dashed border-[var(--color-border)] px-4 py-6 flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                    <ShoppingBag size={24} />
                    <span className="text-[11px] font-bold uppercase tracking-widest">{t("no_shopping_items_yet")}</span>
                  </div>
                )}

                {sortedShoppingItems.map((item) => {
                  const isSelected = selectedShoppingItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border px-3 py-2.5 transition-all ${
                        isSelected
                          ? "border-[var(--color-primary)]/30 bg-[var(--color-primary-subtle)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface)]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={item.status === "purchased"}
                          onChange={() => void toggleShoppingItemStatus(item.id)}
                          className="mt-1 size-4 rounded border-[var(--color-border-strong)] accent-[var(--color-primary)]"
                        />
                        <button
                          onClick={() => setSelectedShoppingItemId(isSelected ? null : item.id)}
                          className="flex-1 text-left"
                        >
                          <p className={`text-sm font-bold ${item.status === "purchased" ? "text-[var(--color-text-muted)] line-through" : "text-[var(--color-text)]"}`}>
                            {item.name}
                          </p>
                          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                            {item.category}
                            {item.preferred_cities?.length ? ` · ${t("trip_view_best_in", { cities: item.preferred_cities.join(", ") })}` : ""}
                          </p>
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              const nextName = window.prompt(t("trip_view_edit_shopping_item"), item.name);
                              if (nextName && nextName.trim()) {
                                void updateShoppingItem(item.id, { name: nextName.trim() });
                              }
                            }}
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => void removeShoppingItem(item.id)}
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BUDGET SUMMARY */}
          {activeTrip && budgetSummary.total > 0 && (
            <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t("trip_budget_title")}</p>
                {tripMapUrl ? (
                  <a
                    href={tripMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-primary)] hover:underline"
                  >
                    {t("trip_map_view")}
                  </a>
                ) : null}
              </div>
              <p className="text-2xl font-black text-[var(--color-text)]">
                {budgetSummary.total.toFixed(2)} <span className="text-xs font-bold text-[var(--color-text-muted)]">{t("trip_view_estimated_short")}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {budgetSummary.perDay.map((d) => (
                  <span key={d.date} className="text-[10px] font-bold text-[var(--color-text-secondary)] bg-[var(--color-surface-subtle)] rounded-full px-2 py-1">
                    {d.date}: {d.total.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* TRAVEL TOOLS — collapsible */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)]">
            <button
              onClick={() => setShowTravelTools(!showTravelTools)}
              className="w-full flex items-center justify-between px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              <span>{t("trip_view_travel_tools")}</span>
              {showTravelTools ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showTravelTools && (
              <div className="px-5 pb-5 space-y-4">
                {activeTrip ? <ArrivalAssistant key={activeTrip.id} context={activeTrip.travelContext} days={activeTrip.days} activeDayId={activeDayId} canEdit={!isInvitee} /> : null}
                {activeDay ? <CityPaymentGuideCard city={activeDay.city} /> : null}
                {activeDay ? <CurrencyConverter city={activeDay.city} /> : null}
                {activeDay ? <EmergencyInfoCard city={activeDay.city} /> : null}
                {activeTrip ? <PackingListCard tripId={activeTrip.id} tripName={activeTrip.name} days={activeTrip.days} travelContext={activeTrip.travelContext} /> : null}
              </div>
            )}
          </div>
        </aside>
        )}
      </div>

      {/* Mobile map overlay */}
      <AnimatePresence>
        {isMobileMapOpen && activeDay && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-50 bg-[var(--color-bg)] lg:hidden"
          >
            {/* Mobile keeps the map open and shows the selection as a bottom card */}
            <DayMapView
              dayId={activeDay.id}
              activities={activeDay.activities}
              city={activeDay.city}
              anchor={mapAnchor ?? undefined}
              activeActivityId={activeMapActivityId}
              canEdit={!isInvitee}
              preferMinimizeWalking={activeTrip?.travelContext?.preferences?.minimizeWalking}
              onActivitySelect={setActiveMapActivityId}
              onToggleComplete={(id, done) => (done ? handleComplete(activeDay.id, id) : handleUncomplete(activeDay.id, id))}
              onOpenDetails={(id) => setEditingActivityId(id)}
              onClose={() => setShowMap(false)}
              floatingActions={<FloatingActions {...floatingActionsProps} />}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ô×ò THE PRIMARY FAB */}
      {/* Over the mobile map overlay the same actions live in the map's bottom dock instead */}
      {!(isMobileMapOpen && activeDay) && (
        <FloatingActions
          {...floatingActionsProps}
          className="fixed right-8 bottom-[calc(env(safe-area-inset-bottom,0px)+2rem)] z-50"
        />
      )}

      {activeTrip && (
        <>
          <TravelContextEditor key={activeTrip.id} context={activeTrip.travelContext} canEdit={!isInvitee} isOpen={travelContextOpen} onClose={() => setTravelContextOpen(false)} />
          <ChatPanel tripId={activeTrip.id} />
        </>
      )}

      {/* ­ƒì▒ ADD ACTIVITY SHEET / MODAL */}
      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdd(false)}
              className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 40 }}
              transition={{ type: "spring", damping: 20 }}
              className="relative w-full max-w-lg bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-10 shadow-xl"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="size-12 rounded-2xl bg-[var(--color-primary)] flex items-center justify-center text-white">
                  <Plus size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-[var(--color-text)]">{t("new_activity")}</h3>
                  <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-widest">{t("trip_view_day_number", { number: activeIndex + 1 })} · {activeDay?.city}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-3 block px-1">
                    {t("title")}
                  </label>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--color-border)] px-6 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--color-primary)]/10 outline-none transition-all bg-[var(--color-surface-subtle)]"
                    placeholder={t("title_placeholder")}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-3 block px-1">{t("time")}</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--color-border)] px-6 py-4 text-sm font-black focus:ring-4 focus:ring-[var(--color-primary)]/10 outline-none transition-all bg-[var(--color-surface-subtle)] tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-3 block px-1">{t("location")}</label>
                  <input
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    className="w-full rounded-2xl border border-[var(--color-border)] px-6 py-4 text-sm font-bold focus:ring-4 focus:ring-[var(--color-primary)]/10 outline-none transition-all bg-[var(--color-surface-subtle)]"
                    placeholder={t("location_placeholder")}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-3 block px-1">{t("notes")}</label>
                  <textarea
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="w-full rounded-[1.5rem] border border-[var(--color-border)] px-6 py-4 text-sm font-medium focus:ring-4 focus:ring-[var(--color-primary)]/10 outline-none transition-all bg-[var(--color-surface-subtle)] min-h-[120px] resize-none"
                    placeholder={t("notes_placeholder")}
                  />
                </div>
              </div>

              <div className="mt-10 flex gap-4">
                <button
                  className="flex-1 px-8 py-5 rounded-2xl bg-[var(--color-surface-subtle)] font-black text-xs uppercase tracking-widest text-[var(--color-text-secondary)]"
                  onClick={() => setShowAdd(false)}
                >
                  {t("cancel")}
                </button>
                <button
                  className="flex-1 px-8 py-5 rounded-2xl bg-[var(--color-primary)] text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-[var(--color-primary)]/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  onClick={() => {
                    if (!newTitle.trim() || !activeDay) return;
                    addActivity({
                      dayId: activeDayId,
                      city: activeDay.city,
                      title: newTitle,
                      time: newTime,
                      durationMin: 60,
                      category: "sightseeing",
                      priority: "medium",
                      state: "pending",
                      notes: newNotes,
                      location: newLocation,
                      sort_order: 0,
                    });
                    setShowAdd(false);
                    setNewTitle("");
                    setNewNotes("");
                    setNewLocation("");
                  }}
                >
                  {t("create_plan")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ­ƒÄƒ´©Å ADD RESERVATION MODAL */}
      <AnimatePresence>
        {showAddReservation && (
          <ReservationEditModal
            isNew={true}
            reservation={{
              id: "new",
              title: "",
              bookingDeadline: format(new Date(), "yyyy-MM-dd"),
              reservationDate: format(new Date(), "yyyy-MM-dd"),
              bookingLink: "",
              urgency: "safe",
              status: "pending",
              price: 0
            }}
            onClose={() => setShowAddReservation(false)}
            onSave={(updates: any) => {
              addReservation(updates);
              setShowAddReservation(false);
            }}
            onDelete={() => {}}
          />
        )}
      </AnimatePresence>

      {/* ­ƒÄƒ´©Å EDIT RESERVATION MODAL */}
      <AnimatePresence>
        {editingReservation && (
          <ReservationEditModal
            isNew={false}
            reservation={editingReservation}
            onClose={() => setEditingReservation(null)}
            onSave={(updates: any) => patchReservation(editingReservation.id, updates)}
            onDelete={() => removeReservation(editingReservation.id)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingActivity && (
          <ActivityEditModal
            activity={editingActivity}
            onClose={() => setEditingActivityId(null)}
            onSave={(updates) => patchActivity(activeDayId, editingActivity.id, updates)}
            onDelete={() => removeActivity(activeDayId, editingActivity.id)}
            onDuplicate={() => duplicateActivity(activeDayId, editingActivity.id)}
            onPreviewFile={(file) => setPreviewFile(file)}
          />
        )}
      </AnimatePresence>



      {previewFile && (
        <WalletPreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          activityTitle={editingActivity?.title || ""}
          onDelete={() => {
            deleteActivityFile(previewFile.id);
            setPreviewFile(null);
          }}
        />
      )}




      {/* Map city prompt */}
      <AnimatePresence>
        {showMapCityPrompt && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMapCityPrompt(false)}
              className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)] p-8 space-y-6"
            >
              <div className="space-y-2">
                <h2 className="text-lg font-black text-[var(--color-text)]">{t("map_set_destination")}</h2>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{t("map_set_destination_hint")}</p>
              </div>
              <div className="space-y-3">
                <button
                  onClick={() => void handleMapUseDeviceLocation()}
                  disabled={mapLocating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-4 rounded-2xl bg-[var(--color-primary)] text-white font-black uppercase tracking-widest text-xs hover:bg-[var(--color-primary-hover)] transition-all shadow-xl shadow-[var(--color-primary)]/20 disabled:opacity-60"
                >
                  {mapLocating ? (
                    <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <MapPin size={14} />
                  )}
                  {mapLocating ? t("map_locating") : t("map_use_my_location")}
                </button>
                <button
                  onClick={handleMapSetCityManually}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] font-bold uppercase tracking-widest text-xs hover:bg-[var(--color-border)] transition-all"
                >
                  <Edit2 size={14} />
                  {t("map_set_city")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingDay && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingDay(null)}
              className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)] p-8"
            >
              <h2 className="text-xl font-black text-[var(--color-text)] mb-6">{t("trip_view_edit_day")}</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] ml-1">{t("trip_view_destination_city")}</label>
                  <input 
                    type="text" 
                    value={editDayCity}
                    onChange={(e) => setEditDayCity(e.target.value)}
                    className="w-full bg-[var(--color-surface-subtle)] border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)] ml-1">{t("trip_view_day_label")}</label>
                  <input 
                    type="text" 
                    value={editDayLabel}
                    onChange={(e) => setEditDayLabel(e.target.value)}
                    className="w-full bg-[var(--color-surface-subtle)] border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={async () => {
                      await updateTripDay(editingDay.id, { city: editDayCity, label: editDayLabel });
                      setEditingDay(null);
                      if (openMapAfterDayEditRef.current) {
                        openMapAfterDayEditRef.current = false;
                        setShowMap(true);
                      }
                    }}
                    className="flex-1 bg-[var(--color-primary)] text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-[var(--color-primary-hover)] transition-all shadow-xl shadow-[var(--color-primary)]/20"
                  >
                    {t("save_changes")}
                  </button>
                  <button
                    onClick={() => {
                      openMapAfterDayEditRef.current = false;
                      setEditingDay(null);
                    }}
                    className="px-6 py-4 rounded-2xl bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] font-bold text-xs uppercase tracking-widest hover:bg-[var(--color-border)] transition-all"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
        onShowToast={(msg) => showToast(msg)}
      />

      {showBookingImport && activeTrip && !isInvitee && (
        <BookingImportModal
          key={activeTrip.id}
          onClose={() => setShowBookingImport(false)}
          onToast={(msg, type) => showToast(msg, type)}
        />
      )}

      <AnimatePresence>
        {showShareModal && activeTrip && (
          <ShareTripModal
            tripId={activeTrip.id}
            tripName={activeTrip.name}
            onClose={() => setShowShareModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {commentActivity && activeTrip && (
          <ActivityCommentsModal
            tripId={activeTrip.id}
            activityId={commentActivity.id}
            activityTitle={commentActivity.title}
            onClose={() => setCommentActivity(null)}
          />
        )}
      </AnimatePresence>

      <CelebrationOverlay
        event={celebrationEvent}
        onDismiss={dismissCelebration}
        onNextDay={goToDay}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[110] font-bold text-xs uppercase tracking-widest ${
              toast.type === "success" ? "bg-[var(--color-text)] text-white" : "bg-[var(--color-danger)] text-white"
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
