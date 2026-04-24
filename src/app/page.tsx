"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
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
  Trash2
} from "lucide-react";
import { optimizeDay } from "@/lib/ai/optimizer";
import { parseItineraryText } from "@/lib/import/parse-itinerary";
import { Activity, ActivityCategory, CriticalReservation } from "@/lib/types";
import { toCurrency, getMidpointTime, addMinutes } from "@/lib/utils";
import { useItineraryStore } from "@/store/use-itinerary-store";

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
              {activity.category}
            </span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest tabular-nums">
              · {activity.durationMin}M
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
                Location pending
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
                placeholder="Adventure Title..."
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
                    <span className="text-xs font-bold uppercase tracking-wider">{cat}</span>
                  </button>
                );
              })}
            </div>

            {/* Time & Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><Clock3 size={12}/> Time</label>
                <input
                  type="time"
                  value={localTime}
                  onChange={(e) => setLocalTime(e.target.value)}
                  className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                />
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Duration</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={localDuration}
                    onChange={(e) => setLocalDuration(parseInt(e.target.value) || 0)}
                    className="w-full bg-transparent text-xl font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                  />
                  <span className="text-[10px] font-black text-slate-300">MINS</span>
                </div>
              </div>
            </div>

            {/* Location & Cost */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><MapPin size={12}/> Location</label>
                <input
                  type="text"
                  value={localLocation}
                  onChange={(e) => setLocalLocation(e.target.value)}
                  placeholder="Where is it?"
                  className="w-full bg-transparent text-sm font-bold border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                />
              </div>
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><CreditCard size={12}/> Est. Cost</label>
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
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1"><FileText size={12}/> Notes</label>
              <textarea
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                placeholder="Special instructions, tickets needed..."
                className="w-full bg-transparent text-sm font-medium border-none p-0 outline-none focus:ring-0 min-h-[120px] resize-none text-slate-900 dark:text-white leading-relaxed"
              />
            </div>
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
             Save Changes
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
  const [localTitle, setLocalTitle] = useState(reservation.title || "");
  const [localDate, setLocalDate] = useState(reservation.reservationDate || "");
  const [localDeadline, setLocalDeadline] = useState(reservation.bookingDeadline || "");
  const [localLink, setLocalLink] = useState(reservation.bookingLink || "");
  const [localPrice, setLocalPrice] = useState(reservation.price || 0);

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
                placeholder="Reservation Title..."
                autoFocus
              />
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><CalendarDays size={12}/> Reservation Date</label>
              <input
                type="date"
                value={localDate}
                onChange={(e) => setLocalDate(e.target.value)}
                className="w-full bg-transparent text-lg font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><Clock3 size={12}/> Booking Deadline</label>
                <input
                  type="date"
                  value={localDeadline}
                  onChange={(e) => setLocalDeadline(e.target.value)}
                  className="w-full bg-transparent text-base font-black tabular-nums border-none p-0 outline-none focus:ring-0 text-slate-900 dark:text-white"
                />
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 rounded-3xl p-5 border border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><CreditCard size={12}/> Price</label>
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
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><ExternalLink size={12}/> Booking Link</label>
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
             Save Reservation
           </button>
        </div>
      </motion.div>
    </div>
  );
}



export default function Home() {
  const {
    trip,
    activeDayId,
    setActiveDay,
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
    fetchTrip,
    removeActivity,
    duplicateActivity,
    addReservation,
    patchReservation,
    removeReservation,
    isOptimizing,
    optimizeDay: runOptimizeDay
  } = useItineraryStore();

  const [showAdd, setShowAdd] = useState(false);
  const [showAddReservation, setShowAddReservation] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [editingReservation, setEditingReservation] = useState<CriticalReservation | null>(null);
  const [slideDirection, setSlideDirection] = useState(1);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("09:00");
  const [newNotes, setNewNotes] = useState("");
  const [newLocation, setNewLocation] = useState("");
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

  useEffect(() => {
    if (isMounted) {
      console.log("Plania: fetchTrip triggered");
      fetchTrip();
    }
  }, [fetchTrip, isMounted]);

  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = dayScrollY[activeDayId] ?? 0;
    }
  }, [activeDayId, dayScrollY]);

  const activeIndex = trip ? Math.max(0, trip.days.findIndex((d) => d.id === activeDayId)) : 0;
  const activeDay = trip?.days[activeIndex];

  const completion = useMemo(() => {
    if (!trip || !activeDay) return { tripPct: 0, dayPct: 0, cityPct: 0 };
    const all = trip.days.flatMap((d) => d.activities);
    const done = all.filter((a) => a.state === "completed").length;
    const dayDone = activeDay.activities.filter((a) => a.state === "completed").length;
    const cityItems = all.filter((a) => a.city === activeDay.city);
    const cityDone = cityItems.filter((a) => a.state === "completed").length;
    return {
      tripPct: all.length ? Math.round((done / all.length) * 100) : 0,
      dayPct: activeDay.activities.length ? Math.round((dayDone / activeDay.activities.length) * 100) : 0,
      cityPct: cityItems.length ? Math.round((cityDone / cityItems.length) * 100) : 0,
    };
  }, [trip, activeDay]);

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

  if (!isMounted || (loading && !trip)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading Adventure...</p>
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
          <h2 className="text-xl font-black text-slate-900 mb-2">Connection Issue</h2>
          <p className="text-slate-500 text-sm mb-8">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-slate-900 text-white rounded-2xl py-4 font-bold"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

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

  const handleSwipeEnd = (e: any, info: any) => {
    if (!trip) return;
    const swipeThreshold = 50;
    if (info.offset.x < -swipeThreshold && activeIndex < trip.days.length - 1) {
      setSlideDirection(1);
      setActiveDay(trip.days[activeIndex + 1].id);
    } else if (info.offset.x > swipeThreshold && activeIndex > 0) {
      setSlideDirection(-1);
      setActiveDay(trip.days[activeIndex - 1].id);
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
    if (!trip) return;
    const todayDay = trip.days.find((day) => day.date === today);
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

  if (!isMounted || !trip || !activeDay) return null;

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-32">
      {/* 💎 PREMIUM STICKY HEADER */}
      <header className="sticky top-0 z-40 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50 px-5 pt-6 pb-4">
        <div className="max-w-7xl mx-auto flex items-end justify-between mb-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white leading-none">
              {trip.name}
            </h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">
              Adventure Itinerary
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
             <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">{completion.tripPct}%</span>
                <div className="w-24 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${completion.tripPct}%` }}
                    className="h-full bg-linear-to-r from-indigo-500 to-violet-500 rounded-full"
                  />
                </div>
             </div>
             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Trip Status</p>
          </div>
        </div>

        {/* 🍱 THE DATE STRIP slider */}
        <div className="max-w-7xl mx-auto flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x">
          {trip.days.map((day, index) => {
            const isActive = day.id === activeDayId;
            const isToday = day.date === today;
            return (
              <button
                key={day.id}
                onClick={() => setActiveDay(day.id)}
                className={`snap-center flex flex-col items-center min-w-[70px] py-4 px-2 rounded-3xl transition-all duration-500 relative border ${
                  isActive 
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-xl translate-y-[-4px]" 
                    : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:bg-slate-50"
                }`}
              >
                <span className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isActive ? "text-indigo-400" : "text-slate-400"}`}>
                  {format(day.date, "EEE")}
                </span>
                <span className="text-lg font-black tracking-tighter">
                  {format(day.date, "d")}
                </span>
                {isToday && !isActive && (
                  <div className="absolute top-2 right-2 size-1.5 rounded-full bg-indigo-500" />
                )}
                {isActive && (
                  <motion.div layoutId="date-active" className="absolute -bottom-1 size-1 bg-indigo-400 rounded-full shadow-lg shadow-indigo-400/50" />
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-5 pt-8 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">
        {/* 🕰️ MAIN TIMELINE FLOW */}
        <div className="space-y-8">
          {/* DAY INTRO */}
          <div className="flex items-center justify-between mb-4">
             <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                    <CalendarDays size={20} />
                  </div>
                  <h2 className="text-xl font-black text-slate-900 dark:text-white">
                    {format(activeDay.date, "EEEE, MMM d")}
                  </h2>
                </div>
                <div className="flex items-center gap-2 ml-13">
                  <MapPin size={12} className="text-slate-400" />
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{activeDay.city}</p>
                </div>
             </div>
             
             <div className="flex items-center gap-2">
               <button 
                  onClick={() => runOptimizeDay(activeDayId)}
                  disabled={isOptimizing}
                  className="px-4 py-2 rounded-2xl bg-fuchsia-50 dark:bg-fuchsia-900/30 text-fuchsia-600 dark:text-fuchsia-400 text-[10px] font-black uppercase tracking-widest hover:bg-fuchsia-100 transition-all border border-fuchsia-100/50 flex items-center gap-2 disabled:opacity-50"
               >
                  {isOptimizing ? <div className="size-3 border-2 border-fuchsia-600/20 border-t-fuchsia-600 rounded-full animate-spin" /> : <Sparkles size={12} />}
                  Day Genius
               </button>
               <button 
                  onClick={jumpToToday}
                  className="px-4 py-2 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-100/50"
               >
                  Today
               </button>
             </div>
          </div>

          {/* PROGRESS CARDS GRID */}
          <div className="grid grid-cols-2 gap-4">
              <div className="premium-card p-5 border-l-4 border-l-indigo-500">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Day Progress</span>
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
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-2">Budget Status</span>
                  <div className="flex items-end justify-between">
                      <span className="text-xl font-black text-slate-900 dark:text-white">
                        {toCurrency(activeDay.activities.reduce((sum, a) => sum + (a.expectedCost ?? 0), 0))}
                      </span>
                      <CreditCard size={24} className="text-violet-500 mb-1" />
                  </div>
                  <p className="text-[10px] font-bold text-slate-500 mt-3">Estimated for {activeDay.city}</p>
              </div>
          </div>

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
                           <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Scheduled Adventure</h3>
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
                                  onEdit={() => setEditingActivity(activity)}
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
                           <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Memory Lane</h3>
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
                                  onEdit={() => setEditingActivity(activity)}
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
                          Where to first?
                        </h3>
                        <p className="text-slate-500 text-sm max-w-[240px] mx-auto mt-2 leading-relaxed">
                          Your itinerary is a blank canvas. Start adding destinations to begin the adventure.
                        </p>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* 🍱 SIDEBAR / SECONDARY CONTENT */}
        <aside className="space-y-10">
          {/* TICKET-STYLE RESERVATIONS */}
          <div className="premium-card bg-slate-900 dark:bg-white p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 size-32 bg-indigo-500/10 blur-3xl rounded-full translate-x-12 -translate-y-12" />
            
            <div className="flex items-center justify-between mb-6 relative z-10">
              <h3 className="text-lg font-black text-white dark:text-slate-900 flex items-center gap-3">
                <CreditCard className="text-indigo-400" size={24} />
                Reservations
              </h3>
              <button
                onClick={() => setShowAddReservation(true)}
                className="size-8 rounded-xl bg-white/10 dark:bg-slate-900/10 text-white dark:text-slate-900 hover:bg-white/20 dark:hover:bg-slate-900/20 flex items-center justify-center transition-all"
              >
                <Plus size={18} />
              </button>
            </div>

            <div className="space-y-4 relative z-10">
              {trip.criticalReservations.length === 0 && (
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 text-center py-4">No reservations yet.</p>
              )}
              {trip.criticalReservations.map((booking) => {
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
                            {booking.status}
                          </span>
                          {booking.urgency === "today" && !isBooked && (
                            <span className="text-[8px] font-black text-rose-400 animate-pulse">CRITICAL</span>
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
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste your notes like:&#10;14:00 Lunch at Bukchon&#10;16:00 Photo session..."
                className="w-full h-40 bg-white/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 transition-all resize-none outline-none shadow-sm"
              />
              <Bot className="absolute bottom-4 right-4 text-slate-200" size={24} />
            </div>
            <button
              className={`w-full rounded-[1.5rem] px-5 py-4 text-xs font-black transition-all shadow-xl tracking-widest uppercase disabled:opacity-80 disabled:scale-100 ${
                isImporting 
                  ? "bg-slate-800 dark:bg-slate-200 text-white/50 dark:text-slate-900/50 cursor-wait" 
                  : "bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed"
              }`}
              disabled={isImporting || !importText.trim()}
              onClick={async () => {
                if (!importText.trim() || isImporting) return;
                try {
                  setIsImporting(true);
                  
                  const res = await fetch("/api/import", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      text: importText,
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
                      city: "AI Imported"
                    }));

                    await addImportedActivities(activeDayId, newOnes);
                    setImportText(""); // This ensures the text area clears
                  }
                } catch (e) {
                  console.error("Error with AI Import", e);
                  alert("Hubo un error con la IA. Verifica tu API Key o conexión.");
                } finally {
                  setIsImporting(false); // Synchronous local state update batched by React
                }
              }}
            >
              {isImporting ? "Processing Magic..." : "Sync to Timeline"}
            </button>
          </div>

          {/* AI OPTIMIZER CARD */}
          <div className="premium-card p-8 border-2 border-indigo-500/30 shadow-indigo-500/5">
             <div className="flex items-center justify-between mb-8">
                <div className="space-y-1">
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">Day Genius</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">AI Route Optimization</p>
                </div>
                <Bot className="text-indigo-500" size={32} />
             </div>

             <button className="w-full rounded-[1.5rem] bg-indigo-600 px-6 py-4 text-xs font-black text-white shadow-xl shadow-indigo-500/30 hover:bg-indigo-700 transition-all tracking-widest uppercase mb-8">
                Run Optimizer
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

      {/* ➕ THE PRIMARY FAB */}
      <motion.button
        whileHover={{ scale: 1.1, rotate: 90 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowAdd(true)}
        className="fixed bottom-8 right-8 size-18 rounded-[2rem] bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-2xl flex items-center justify-center z-50 transition-all ring-8 ring-indigo-500/10"
      >
        <Plus size={36} />
      </motion.button>

      {/* 🍱 ADD ACTIVITY SHEET / MODAL */}
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
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">New Adventure</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Day {activeIndex + 1} · {activeDay.city}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">
                    Activity Name
                  </label>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50"
                    placeholder="e.g., Summit at Fuji"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">Start Time</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-black focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50 tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">Location</label>
                  <input
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50"
                    placeholder="Search place..."
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block px-1">Notes</label>
                  <textarea
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="w-full rounded-[1.5rem] border border-slate-200 dark:border-slate-800 px-6 py-4 text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all bg-slate-50/50 dark:bg-slate-950/50 min-h-[120px] resize-none"
                    placeholder="What should we remember?..."
                  />
                </div>
              </div>

              <div className="mt-10 flex gap-4">
                <button
                  className="flex-1 px-8 py-5 rounded-2xl bg-slate-100 dark:bg-slate-800 font-black text-xs uppercase tracking-widest text-slate-500"
                  onClick={() => setShowAdd(false)}
                >
                  Discard
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
                  Create Plan
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 🎟️ ADD RESERVATION MODAL */}
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

      {/* 🎟️ EDIT RESERVATION MODAL */}
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
            onClose={() => setEditingActivity(null)}
            onSave={(updates) => patchActivity(activeDayId, editingActivity.id, updates)}
            onDelete={() => removeActivity(activeDayId, editingActivity.id)}
            onDuplicate={() => duplicateActivity(activeDayId, editingActivity.id)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
