"use client";

// TripView — full itinerary UI rendered at /trips
// AuthInitializer handles routing here once activeTrip is ready.

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { 
  Bot, 
  CalendarDays, 
  CheckCircle2, 
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
  Utensils,
  Bed,
  Camera,
  ShoppingBag,
  Music,
  Map as MapIcon,
  Info,
  Trash2,
  Mic,
  MicOff,
  Edit2,
  X,
  Loader2,
  Globe,
  User as UserIcon,
  LogOut,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  ArrowRight
} from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useAuthStore } from "@/store/use-auth-store";
import { AuthModal } from "@/components/AuthModal";
import { optimizeDay } from "@/lib/ai/optimizer";
import { parseItineraryText } from "@/lib/import/parse-itinerary";
import { Activity, ActivityCategory, CriticalReservation, TripDay, ActivityFile } from "@/lib/types";
import { toCurrency, getMidpointTime, addMinutes } from "@/lib/utils";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { TripSwitcher } from "@/components/TripSwitcher";

const CATEGORY_STYLES: Record<ActivityCategory, { icon: any; color: string; bg: string }> = {
  sightseeing: { icon: MapIcon, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  reservation: { icon: CheckCircle2, color: "text-indigo-600", bg: "bg-indigo-50 dark:bg-indigo-900/20" },
  transport: { icon: Plane, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
  hotel: { icon: Bed, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20" },
  food: { icon: Utensils, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-900/20" },
  shopping: { icon: ShoppingBag, color: "text-fuchsia-600", bg: "bg-fuchsia-50 dark:bg-fuchsia-900/20" },
  photos: { icon: Camera, color: "text-cyan-600", bg: "bg-cyan-50 dark:bg-cyan-900/20" },
  nightlife: { icon: Music, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-900/20" },
  other: { icon: Info, color: "text-slate-500", bg: "bg-slate-100 dark:bg-slate-800" },
};

const getCategoryStyle = (category: string) =>
  CATEGORY_STYLES[category as ActivityCategory] ??
  CATEGORY_STYLES["other" as ActivityCategory];

function SortableActivityCard({
  dayId,
  activity,
  onCompleteSwipe,
  onEdit,
}: {
  dayId: string;
  activity: Activity;
  onCompleteSwipe: (activityId: string) => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: activity.id,
  });
  const updateState = useItineraryStore((s) => s.updateActivityState);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
  };

  const completed = activity.state === "completed";

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 10 }}
      animate={{ 
        opacity: completed ? 0.7 : 1, 
        y: 0,
        scale: isDragging ? 1.02 : 1,
      }}
      exit={{ opacity: 0, scale: 0.95 }}
      layout
      className={`group premium-card overflow-hidden transition-all duration-500 ease-in-out ${
        completed 
          ? "bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/40" 
          : "border-white/20 shadow-lg hover:shadow-indigo-500/5 cursor-pointer"
      }`}
      onClick={onEdit}
      onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStart && e.changedTouches[0].clientX - touchStart > 70 && !completed) {
          onCompleteSwipe(activity.id);
        }
      }}
    >
      <div className="relative p-5 flex gap-4 items-center">
        {/* DRAG HANDLE */}
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-1 top-1/2 -translate-y-1/2 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 md:opacity-100 md:bg-transparent bg-white dark:bg-slate-900"
        >
          <div className="grid grid-cols-2 gap-1 px-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="size-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            ))}
          </div>
        </div>

        {/* TIME & ICON GROUP */}
        <div className="flex flex-col items-center gap-2 shrink-0 ml-4 md:ml-6 pointer-events-none">
          <div className={`size-12 rounded-2xl flex items-center justify-center transition-all duration-500 ${
            completed 
              ? "bg-slate-200 dark:bg-slate-800 text-slate-400" 
              : `${getCategoryStyle(activity.category).bg} ${getCategoryStyle(activity.category).color} shadow-sm group-hover:scale-110`
          }`}>
            {(() => {
              const Icon = getCategoryStyle(activity.category).icon;
              return <Icon size={24} strokeWidth={2.5} />;
            })()}
          </div>
          
          <span className={`text-[11px] font-black tracking-tighter tabular-nums transition-colors ${
            completed ? "text-slate-400" : "text-slate-900 dark:text-slate-100"
          }`}>
            {activity.time}
          </span>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 min-w-0 py-1">
          <div className="flex items-center gap-2 mb-1">
             <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-full ${
                completed 
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-400" 
                  : `${CATEGORY_STYLES[activity.category].bg} ${CATEGORY_STYLES[activity.category].color}`
             }`}>
              {t(activity.category)}
            </span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest tabular-nums">
              ┬À {activity.durationMin}{t("mins_short")}
            </span>
          </div>
          
          <h4
            className={`text-base font-extrabold leading-tight transition-all truncate ${
              completed ? "text-slate-400 line-through" : "text-slate-900 dark:text-white"
            }`}
          >
            {activity.title}
          </h4>
          
          <div className="flex items-center gap-1.5 mt-2">
            <MapPin size={12} className={completed ? "text-slate-300" : "text-slate-400 shrink-0"} />
            {activity.location ? (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  const url = activity.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location as string)}`;
                  window.open(url, "_blank");
                }}
                className={`text-xs font-medium truncate flex items-center gap-1 hover:underline transition-all ${completed ? "text-slate-300" : "text-indigo-500 dark:text-indigo-400 hover:text-indigo-600"}`}
              >
                {activity.location}
                <ExternalLink size={10} className="shrink-0" />
              </button>
            ) : (
              <span className={`text-xs font-medium truncate ${completed ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
                {t("location_pending")}
              </span>
            )}
          </div>
        </div>

        {/* ACTION GROUP */}
        <div className="flex items-center gap-1">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              updateState(dayId, activity.id, completed ? "pending" : "completed");
            }}
            className={`size-12 md:size-10 rounded-[1.2rem] md:rounded-2xl flex items-center justify-center transition-all duration-500 border-2 ${
              completed 
                ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                : "border-slate-200 dark:border-slate-800 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 active:scale-95"
            }`}
          >
            <CheckCircle2 size={24} strokeWidth={completed ? 3 : 2} className={completed ? "scale-110" : "text-slate-300 md:text-slate-200"} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ActivityFilesSection({ 
  activityId, 
  files = [] 
}: { 
  activityId: string; 
  files?: ActivityFile[];
}) {
  const { t } = useI18n();
  const uploadFile = useItineraryStore((s) => s.uploadActivityFile);
  const deleteFile = useItineraryStore((s) => s.deleteActivityFile);
  const loading = useItineraryStore((s) => s.loading);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
          <FileText size={12} /> {t("attachments")}
        </label>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-600 disabled:opacity-50 flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1 rounded-full transition-all"
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
            className="group relative bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-100 dark:border-slate-800 flex items-center gap-3 shadow-sm hover:shadow-md transition-all"
          >
            <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${
              file.fileType === "pdf" ? "bg-rose-50 text-rose-500" : "bg-blue-50 text-blue-500"
            }`}>
              {file.fileType === "pdf" ? <FileText size={20} /> : <Camera size={20} />}
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white truncate pr-6" title={file.fileName}>
                {file.fileName}
              </p>
              <button
                onClick={() => window.open(file.fileUrl, "_blank")}
                className="text-[10px] font-bold text-indigo-500 hover:underline uppercase tracking-wider"
              >
                {t("view_file")}
              </button>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(t("confirm_delete_file"))) {
                  deleteFile(file.id);
                }
              }}
              className="absolute top-2 right-2 p-1 text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        
        {files.length === 0 && !loading && (
          <div className="col-span-full py-6 text-center rounded-2xl border-2 border-dashed border-slate-100 dark:border-slate-800">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {t("no_attachments_hint")}
            </p>
          </div>
        )}

        {loading && (
          <div className="col-span-full py-6 flex items-center justify-center">
            <Loader2 size={20} className="text-indigo-500 animate-spin" />
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
  onDuplicate
}: {
  activity: Activity;
  onClose: () => void;
  onSave: (updates: Partial<Activity>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
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
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-xl"
      />
      
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-white dark:bg-slate-950 rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10 scrollbar-hide">
          <div className="flex justify-center mb-6 md:hidden">
            <div className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" />
          </div>

          <div className="space-y-8">
            {/* Title & Category Row */}
            <div>
              <input
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                className="w-full bg-transparent text-2xl font-black text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 outline-none pb-2 border-b-2 border-transparent focus:border-indigo-500/30 transition-all font-sans"
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
                        ? `${conf.bg} ${conf.color} border-transparent shadow-sm ring-2 ring-indigo-500/20 ring-offset-2 ring-offset-white dark:ring-offset-slate-950` 
                        : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-100"
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
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><Clock3 size={12}/> {t("time")}</label>
                <input
                  type="time"
                  value={localTime}
                  onChange={(e) => setLocalTime(e.target.value)}
                  className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                />
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">{t("duration_mins")}</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={localDuration}
                    onChange={(e) => setLocalDuration(parseInt(e.target.value) || 0)}
                    className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                  />
                  <span className="text-[10px] font-black text-slate-300">{t("mins_short")}</span>
                </div>
              </div>
            </div>

            {/* Location & Cost */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><MapPin size={12}/> {t("location")}</label>
                <input
                  type="text"
                  value={localLocation}
                  onChange={(e) => setLocalLocation(e.target.value)}
                  placeholder={t("location_placeholder")}
                  className="w-full bg-transparent text-sm font-bold border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                />
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><CreditCard size={12}/> {t("expected_cost")}</label>
                <div className="flex items-center gap-1">
                  <span className="text-xl font-black text-slate-400">$</span>
                  <input
                    type="number"
                    value={localCost}
                    onChange={(e) => setLocalCost(parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800 relative">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1"><FileText size={12}/> {t("notes")}</label>

              <textarea
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                placeholder={t("notes_placeholder")}
                className="w-full bg-transparent text-sm font-medium border-none p-0 outline-none focus:ring-0 min-h-[120px] resize-none text-slate-900 dark:text-white leading-relaxed"
              />
            </div>

            {/* Attachments Section */}
            <ActivityFilesSection activityId={activity.id} files={activity.files} />
          </div>
        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="p-4 md:px-10 border-t border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-950 flex gap-3 pb-safe">
           <button 
             onClick={() => { onDelete(); onClose(); }}
             className="size-14 shrink-0 rounded-[1.5rem] bg-rose-50 dark:bg-rose-900/20 text-rose-600 flex items-center justify-center hover:bg-rose-100 transition-colors"
           >
             <Trash2 size={20} />
           </button>
           <button 
             onClick={() => { onDuplicate(); onClose(); }}
             className="size-14 shrink-0 rounded-[1.5rem] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 items-center justify-center hover:bg-indigo-100 transition-colors hidden md:flex"
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
             className="flex-1 rounded-[1.5rem] bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center hover:scale-[1.02] active:scale-[0.98] transition-transform"
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
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-xl"
      />
      
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white dark:bg-slate-950 rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10 scrollbar-hide">
          <div className="flex justify-center mb-6 md:hidden">
            <div className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" />
          </div>

          <div className="space-y-6">
            <div>
              <input
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                className="w-full bg-transparent text-2xl font-black text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 outline-none pb-2 border-b-2 border-transparent focus:border-indigo-500/30 transition-all font-sans"
                placeholder={t("reservation_title_placeholder")}
                autoFocus
              />
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><CalendarDays size={12}/> {t("reservation_date")}</label>
              <input
                type="date"
                min={todayStr}
                value={localDate}
                onChange={(e) => setLocalDate(e.target.value)}
                onClick={(e) => (e.currentTarget as any).showPicker?.()}
                className="w-full bg-transparent text-lg font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><Clock3 size={12}/> {t("booking_deadline")}</label>
                <input
                  type="date"
                  min={todayStr}
                  value={localDeadline}
                  onChange={(e) => setLocalDeadline(e.target.value)}
                  onClick={(e) => (e.currentTarget as any).showPicker?.()}
                  className="w-full bg-transparent text-base font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                />
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><CreditCard size={12}/> {t("price")}</label>
                <div className="flex items-center gap-1">
                  <span className="text-xl font-black text-slate-400">$</span>
                  <input
                    type="number"
                    value={localPrice}
                    onChange={(e) => setLocalPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><ExternalLink size={12}/> {t("booking_link")}</label>
              <input
                type="url"
                value={localLink}
                onChange={(e) => setLocalLink(e.target.value)}
                placeholder="https://..."
                className="w-full bg-transparent text-sm font-bold border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="p-4 md:px-10 border-t border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-950 flex gap-3 pb-safe">
           {!isNew && (
             <button 
               onClick={() => { onDelete(); onClose(); }}
               className="size-14 shrink-0 rounded-[1.5rem] bg-rose-50 dark:bg-rose-900/20 text-rose-600 flex items-center justify-center hover:bg-rose-100 transition-colors"
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
             className="flex-1 rounded-[1.5rem] bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center hover:scale-[1.02] active:scale-[0.98] transition-transform"
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
    isOptimizing,
    optimizeDay: runOptimizeDay,
    addTripDay,
    removeTripDay,
    updateTripDay,
    createTrip,
    hasFetched
  } = useItineraryStore();

  const { user, signOut: authSignOut } = useAuthStore();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [showAdd, setShowAdd] = useState(false);
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
  
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "preview" | "syncing">("idle");
  const [previewCountdown, setPreviewCountdown] = useState(0);
  const recognitionRef = useRef<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const cancelVoice = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVoiceState("idle");
    setPreviewCountdown(0);
  };

  const handleImportSync = async (textToSync: string) => {
    if (!textToSync.trim() || isImporting) return;
    try {
      setIsImporting(true);
      if (voiceState === "preview") setVoiceState("syncing");
      
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSync,
          fallbackDate: activeDay?.date || new Date().toISOString()
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
          userId: user?.id || ""
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

  if (!isMounted || (loading && !activeTrip)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">
            {isMounted ? t("loading_adventure") : "Loading..."}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-8 text-center">
        <div className="premium-card p-12 max-w-md">
          <div className="size-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Info className="text-rose-600" size={32} />
          </div>
          <h2 className="text-xl font-black text-slate-900 mb-2">{t("connection_issue")}</h2>
          <p className="text-slate-500 text-sm mb-8">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-slate-900 text-white rounded-2xl py-4 font-bold"
          >
            {t("retry_connection")}
          </button>
        </div>
      </div>
    );
  }

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

  if (!isMounted || (loading && !activeTrip)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading\u2026</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-32">
      {/* COMPACT STICKY HEADER */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
        {/* Top bar: trip selector + controls */}
        <div className="flex items-center justify-between px-4 h-14 md:h-16 max-w-7xl mx-auto">
          {/* Left: Trip Switcher */}
          <TripSwitcher />

          {/* Right: user controls */}
          <div className="flex items-center gap-2">
            {/* Language picker ÔÇö hidden on smallest screens */}
            <div className="hidden xs:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-full px-2 py-1">
              <Globe size={10} className="text-slate-400" />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="bg-transparent text-[9px] font-bold text-slate-500 uppercase cursor-pointer outline-none appearance-none"
              >
                <option value="en">EN</option>
                <option value="es">ES</option>
              </select>
            </div>

            {user && !user.is_anonymous ? (
              <div className="flex items-center gap-1.5">
                <div className="size-7 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-500 border border-indigo-100 dark:border-indigo-800">
                  <UserIcon size={12} />
                </div>
                <button
                  onClick={() => authSignOut()}
                  className="size-7 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors"
                >
                  <LogOut size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md shadow-indigo-500/20"
              >
                <ShieldCheck size={10} />
                <span>Save</span>
              </button>
            )}
          </div>
        </div>

        {/* Date strip */}
        <div className="flex gap-2 overflow-x-auto pb-2 pt-1 px-4 scrollbar-hide snap-x max-w-7xl mx-auto">
          {activeTrip?.days.map((day) => {
            const isActive = day.id === activeDayId;
            const isToday = day.date === today;
            return (
              <button
                key={day.id}
                onClick={() => setActiveDay(day.id)}
                className={`snap-center flex flex-col items-center min-w-[52px] py-2.5 px-1.5 rounded-2xl transition-all duration-300 relative border flex-shrink-0 ${
                  isActive
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-lg -translate-y-0.5"
                    : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:bg-slate-50"
                }`}
              >
                <span className={`text-[9px] font-black uppercase tracking-wider mb-0.5 ${isActive ? "text-indigo-400" : "text-slate-400"}`}>
                  {format(day.date, "EEE", { locale: dateFnsLocale })}
                </span>
                <span className="text-base font-black tracking-tight leading-none">
                  {format(day.date, "d", { locale: dateFnsLocale })}
                </span>
                {isToday && !isActive && (
                  <div className="absolute top-1.5 right-1.5 size-1 rounded-full bg-indigo-500" />
                )}
                {isActive && (
                  <motion.div layoutId="date-active" className="absolute -bottom-0.5 size-1 bg-indigo-400 rounded-full shadow shadow-indigo-400/50" />
                )}
              </button>
            );
          })}

          <button
            onClick={handleAddDay}
            className="snap-center flex flex-col items-center justify-center min-w-[52px] h-[62px] py-2 px-1.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-900/10 border-2 border-dashed border-indigo-200 dark:border-indigo-800 text-indigo-500 hover:bg-indigo-50 transition-all flex-shrink-0"
          >
            <Plus size={18} />
            <span className="text-[7px] font-black uppercase tracking-widest mt-0.5">Day</span>
          </button>
        </div>
      </header>


      <div className="max-w-7xl mx-auto px-5 pt-8 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">
        {/* ­ƒò░´©Å MAIN TIMELINE FLOW */}
        <div className="space-y-8">
          {/* DAY INTRO */}
          {activeDay ? (
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                    <CalendarDays size={20} />
                  </div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white">
                    {format(activeDay.date, "EEEE, MMM d", { locale: dateFnsLocale })}
                  </h2>
                </div>
                <div className="flex items-center gap-2 ml-13">
                  <MapPin size={12} className="text-slate-400" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{activeDay.city}</p>
                  <button 
                    onClick={() => {
                      setEditingDay(activeDay);
                      setEditDayCity(activeDay.city);
                      setEditDayLabel(activeDay.label);
                    }}
                    className="p-1 text-slate-300 hover:text-indigo-500 transition-colors"
                  >
                    <Edit2 size={10} />
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    if (confirm("Delete this entire day and all its activities?")) {
                      removeTripDay(activeDayId);
                    }
                  }}
                  className="size-8 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-400 hover:text-rose-500 flex items-center justify-center transition-all border border-slate-100 dark:border-slate-800"
                  title="Remove Day"
                >
                  <Trash2 size={14} />
                </button>
                <button 
                  onClick={() => runOptimizeDay(activeDayId)}
                  disabled={isOptimizing}
                  className="px-4 py-2 rounded-2xl bg-fuchsia-50 dark:bg-fuchsia-900/30 text-fuchsia-600 dark:text-fuchsia-400 text-[10px] font-black uppercase tracking-widest hover:bg-fuchsia-100 transition-all border border-fuchsia-100/50 flex items-center gap-2 disabled:opacity-50"
                >
                  {isOptimizing ? <div className="size-3 border-2 border-fuchsia-600/20 border-t-fuchsia-600 rounded-full animate-spin" /> : <Sparkles size={12} />}
                  {t("day_genius")}
                </button>
                <button 
                  onClick={jumpToToday}
                  className="px-4 py-2 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-100/50"
                >
                  {t("today")}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-800 text-center space-y-4">
              <div className="size-16 bg-slate-50 dark:bg-slate-900 rounded-3xl flex items-center justify-center mx-auto text-slate-300">
                <CalendarDays size={32} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">No days found</h3>
                <p className="text-sm text-slate-400">Add your first destination to start planning.</p>
              </div>
              <button 
                onClick={handleAddDay}
                className="px-6 py-3 rounded-2xl bg-indigo-600 text-white font-bold text-sm shadow-xl shadow-indigo-500/20"
              >
                Add Day 1
              </button>
            </div>
          )}

          {activeDay && (
            <div className="grid grid-cols-2 gap-4">
                <div className="premium-card p-5 border-l-4 border-l-indigo-500">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">{t("day_progress")}</span>
                    <div className="flex items-end justify-between">
                        <span className="text-2xl font-black text-slate-900 dark:text-white">{completion.dayPct}%</span>
                        <CheckCircle2 size={24} className="text-indigo-500 mb-1" />
                    </div>
                    <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full mt-3 overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${completion.dayPct}%` }}
                          className="h-full bg-indigo-500 rounded-full"
                        />
                    </div>
                </div>
                <div className="premium-card p-5 border-l-4 border-l-violet-500">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">{t("budget_status")}</span>
                    <div className="flex items-end justify-between">
                        <span className="text-xl font-black text-slate-900 dark:text-white">
                          {toCurrency(activeDay.activities.reduce((sum, a) => sum + (a.expectedCost ?? 0), 0))}
                        </span>
                        <CreditCard size={24} className="text-violet-500 mb-1" />
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 mt-3">{t("estimated_for", { city: activeDay.city })}</p>
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
                <div className="absolute left-[38px] top-6 bottom-6 w-0.5 bg-slate-100 dark:bg-slate-800 hidden md:block" />

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
                    {/* SCHEDULED SECTION */}
                    {sortedActivities.some(a => a.state !== "completed") && (
                      <div className="space-y-4">
                        <div className="flex items-center gap-3 ml-2">
                           <div className="size-2 rounded-full bg-indigo-500 shadow-lg shadow-indigo-500/50" />
                           <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{t("scheduled_adventure")}</h3>
                        </div>
                        <div className="space-y-4">
                          {sortedActivities
                            .filter((a) => a.state !== "completed")
                            .map((activity) => (
                              <div key={activity.id} className="relative group">
                                <SortableActivityCard
                                  dayId={activeDayId}
                                  activity={activity}
                                  onCompleteSwipe={(id) => updateActivityState(activeDayId, id, "completed")}
                                  onEdit={() => setEditingActivityId(activity.id)}
                                />
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* COMPLETED SECTION */}
                    {sortedActivities.some(a => a.state === "completed") && (
                      <div className="space-y-4 opacity-70">
                        <div className="flex items-center gap-3 ml-2">
                           <div className="size-2 rounded-full bg-slate-300" />
                           <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">{t("memory_lane")}</h3>
                        </div>
                        <div className="space-y-4">
                          {sortedActivities
                            .filter((a) => a.state === "completed")
                            .map((activity) => (
                              <div key={activity.id} className="relative group">
                                <SortableActivityCard
                                  dayId={activeDayId}
                                  activity={activity}
                                  onCompleteSwipe={(id) => updateActivityState(activeDayId, id, "completed")}
                                  onEdit={() => setEditingActivityId(activity.id)}
                                />
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {sortedActivities.length === 0 && (
                      <div className="py-24 text-center">
                        <div className="size-24 bg-white dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[3rem] flex items-center justify-center mx-auto mb-8 transition-transform hover:scale-110">
                          <Plane className="text-slate-200" size={40} />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 dark:text-white">
                          {t("where_to_first")}
                        </h3>
                        <p className="text-slate-500 text-sm max-w-[240px] mx-auto mt-2 leading-relaxed">
                          {t("empty_itinerary_hint")}
                        </p>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* ­ƒì▒ SIDEBAR / SECONDARY CONTENT */}
        <aside className="space-y-10">
          {/* TICKET-STYLE RESERVATIONS */}
          <div className="premium-card bg-slate-900 dark:bg-white p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 size-32 bg-indigo-500/10 blur-3xl rounded-full translate-x-12 -translate-y-12" />
            
            <div className="flex items-center justify-between mb-6 relative z-10">
              <h3 className="text-lg font-black text-white dark:text-slate-900 flex items-center gap-3">
                <CreditCard className="text-indigo-400" size={24} />
                {t("critical_reservations")}
              </h3>
              <button
                onClick={() => setShowAddReservation(true)}
                className="size-8 rounded-xl bg-white/10 dark:bg-slate-900/10 text-white dark:text-slate-900 hover:bg-white/20 dark:hover:bg-slate-900/20 flex items-center justify-center transition-all"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-4 relative z-10">
              {(activeTrip?.criticalReservations.length === 0) && (
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 text-center py-4">{t("no_reservations_yet")}</p>
              )}
              {(activeTrip?.criticalReservations ?? []).map((booking) => {
                const isBooked = booking.status === "booked";
                return (
                  <div
                    key={booking.id}
                    onClick={() => setEditingReservation(booking)}
                    className={`rounded-2xl p-4 transition-all border cursor-pointer ${
                      isBooked
                        ? "bg-slate-800/50 dark:bg-slate-50 border-transparent opacity-50 ring-1 ring-slate-700 dark:ring-slate-200"
                        : "bg-slate-800 dark:bg-slate-50 border-indigo-500/30 dark:border-indigo-200/50 shadow-lg hover:translate-y-[-2px]"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            isBooked ? "bg-slate-700 text-slate-400" : "bg-indigo-500 text-white"
                          }`}>
                            {t(booking.status)}
                          </span>
                          {booking.urgency === "today" && !isBooked && (
                            <span className="text-[8px] font-black text-rose-400 animate-pulse">{t("critical")}</span>
                          )}
                        </div>
                        <h4 className={`text-sm font-black transition-colors ${isBooked ? "text-slate-500 line-through" : "text-white dark:text-slate-900"}`}>
                          {booking.title}
                        </h4>
                        <p className="text-[10px] font-medium text-slate-400">
                          {booking.reservationDate}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isBooked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleBooking(booking.id)}
                        className="size-6 rounded-full border-2 border-slate-700 dark:border-slate-300 checked:bg-indigo-500 checked:border-indigo-500 transition-all cursor-pointer accent-indigo-500"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PRO AI IMPORT SECTION */}
          <div className="premium-card p-6 bg-linear-to-br from-indigo-500/5 to-violet-500/5 border-indigo-500/20">
            <h3 className="text-lg font-black text-slate-900 dark:text-white mb-4 flex items-center gap-3">
              <Sparkles className="text-indigo-500" size={22} />
              AI Power Import
            </h3>
            <div className="relative mb-4">
               <textarea
                value={importText}
                onChange={(e) => handleImportTextChange(e.target.value)}
                placeholder="Paste your notes like:&#10;14:00 Lunch at Bukchon&#10;16:00 Photo session..."
                className={`w-full h-40 bg-white/50 dark:bg-slate-950/50 border ${voiceState === 'listening' ? 'border-red-400 dark:border-red-500 ring-4 ring-red-500/10' : 'border-slate-200 dark:border-slate-800'} rounded-3xl p-5 text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 transition-all resize-none outline-none shadow-sm`}
              />
              
              <div className="absolute bottom-4 right-4 flex items-center gap-2">
                {voiceState === "preview" && (
                  <div className="flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 py-1.5 rounded-full shadow-lg animate-in slide-in-from-bottom-2">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">Syncing in {previewCountdown}s</span>
                    <button onClick={cancelVoice} className="hover:bg-slate-700 dark:hover:bg-slate-200 p-0.5 rounded-full transition-colors">
                      <X size={12} />
                    </button>
                    <button onClick={cancelVoice} className="hover:bg-slate-700 dark:hover:bg-slate-200 p-0.5 rounded-full transition-colors ml-1" title="Edit manually">
                      <Edit2 size={12} />
                    </button>
                  </div>
                )}

                {isSpeechSupported && voiceState === "idle" && (
                  <button onClick={startListening} className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all">
                    <Mic size={20} />
                  </button>
                )}
                
                {voiceState === "listening" && (
                  <button onClick={cancelVoice} className="p-2 rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 animate-pulse transition-all">
                    <Mic size={20} />
                  </button>
                )}

                {voiceState === "syncing" && (
                  <Loader2 size={24} className="text-indigo-500 animate-spin" />
                )}
                
                {voiceState === "idle" && !isSpeechSupported && (
                  <Bot className="text-slate-200" size={24} />
                )}
              </div>
            </div>
            
            <button
              className={`w-full rounded-[1.5rem] px-5 py-4 text-xs font-black transition-all shadow-xl tracking-widest uppercase disabled:opacity-80 disabled:scale-100 ${
                isImporting || voiceState === 'syncing'
                  ? "bg-slate-800 dark:bg-slate-200 text-white/50 dark:text-slate-900/50 cursor-wait" 
                  : "bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed"
              }`}
              disabled={isImporting || voiceState === 'syncing' || !importText.trim()}
              onClick={() => handleImportSync(importText)}
            >
              {isImporting || voiceState === 'syncing' ? t("processing_magic") : t("sync_to_timeline")}
            </button>
          </div>

          {/* AI OPTIMIZER CARD */}
          <div className="premium-card p-8 border-2 border-indigo-500/30 shadow-indigo-500/5">
             <div className="flex items-center justify-between mb-8">
                <div className="space-y-1">
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{t("day_genius")}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t("ai_route_optimization")}</p>
                </div>
                <Bot className="text-indigo-500" size={32} />
             </div>

             <button className="w-full rounded-[1.5rem] bg-indigo-600 px-6 py-4 text-xs font-black text-white shadow-xl shadow-indigo-500/30 hover:bg-indigo-700 transition-all tracking-widest uppercase mb-8">
                {t("run_optimizer")}
             </button>

             <div className="space-y-4">
                {suggestions.map((s) => (
                  <div key={s.id} className="flex gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm transition-all hover:scale-105">
                     <div className="size-8 rounded-xl bg-white dark:bg-slate-800 flex items-center justify-center text-indigo-500 shrink-0">
                        <Sparkles size={16} />
                     </div>
                     <div className="space-y-1">
                        <p className="text-xs font-black text-slate-900 dark:text-white tracking-tight">{s.title}</p>
                        <p className="text-[10px] text-slate-400 font-medium leading-relaxed">{s.reason}</p>
                     </div>
                  </div>
                ))}
             </div>
          </div>
        </aside>
      </div>

      {/* Ô×ò THE PRIMARY FAB */}
      <motion.button
        whileHover={{ scale: 1.1, rotate: 90 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowAdd(true)}
        className="fixed bottom-8 right-8 size-18 rounded-[2rem] bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-2xl flex items-center justify-center z-50 transition-all ring-8 ring-indigo-500/10"
      >
        <Plus size={36} />
      </motion.button>

      {/* ­ƒì▒ ADD ACTIVITY SHEET / MODAL */}
      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdd(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xl"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 40 }}
              transition={{ type: "spring", damping: 20 }}
              className="relative w-full max-w-lg premium-card p-10 bg-white dark:bg-slate-900 border-indigo-500/20 shadow-indigo-500/10"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="size-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white">
                  <Plus size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">{t("new_activity")}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Day {activeIndex + 1} ┬À {activeDay?.city}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">
                    {t("title")}
                  </label>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50"
                    placeholder={t("title_placeholder")}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">{t("time")}</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-black focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50 tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">{t("location")}</label>
                  <input
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50"
                    placeholder={t("location_placeholder")}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">{t("notes")}</label>
                  <textarea
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="w-full rounded-[1.5rem] border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50 min-h-[120px] resize-none"
                    placeholder={t("notes_placeholder")}
                  />
                </div>
              </div>

              <div className="mt-10 flex gap-4">
                <button
                  className="flex-1 px-8 py-5 rounded-2xl bg-slate-100 dark:bg-slate-800 font-black text-xs uppercase tracking-widest text-slate-500"
                  onClick={() => setShowAdd(false)}
                >
                  {t("cancel")}
                </button>
                <button
                  className="flex-1 px-8 py-5 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
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
          />
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
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-800 p-8"
            >
              <h2 className="text-xl font-black text-slate-900 dark:text-white mb-6">Edit Day</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Destination City</label>
                  <input 
                    type="text" 
                    value={editDayCity}
                    onChange={(e) => setEditDayCity(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Day Label</label>
                  <input 
                    type="text" 
                    value={editDayLabel}
                    onChange={(e) => setEditDayLabel(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={async () => {
                      await updateTripDay(editingDay.id, { city: editDayCity, label: editDayLabel });
                      setEditingDay(null);
                    }}
                    className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-500/20"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setEditingDay(null)}
                    className="px-6 py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
                  >
                    Cancel
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

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[110] font-bold text-xs uppercase tracking-widest ${
              toast.type === "success" ? "bg-slate-900 text-white" : "bg-rose-500 text-white"
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
