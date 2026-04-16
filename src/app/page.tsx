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
import { Activity, ActivityCategory } from "@/lib/types";
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
};

function SortableActivityCard({
  dayId,
  activity,
  onCompleteSwipe,
}: {
  dayId: string;
  activity: Activity;
  onCompleteSwipe: (activityId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: activity.id,
  });
  const updateState = useItineraryStore((s) => s.updateActivityState);
  const duplicate = useItineraryStore((s) => s.duplicateActivity);
  const patchActivity = useItineraryStore((s) => s.patchActivity);
  const removeActivity = useItineraryStore((s) => s.removeActivity);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

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
          : "border-white/20 shadow-lg hover:shadow-indigo-500/5"
      }`}
      onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStart && e.changedTouches[0].clientX - touchStart > 70 && !completed) {
          onCompleteSwipe(activity.id);
        }
      }}
    >
      <div className="relative p-5 flex gap-4 items-center">
        <div
          {...attributes}
          {...listeners}
          className="absolute left-1 top-1/2 -translate-y-1/2 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100"
        >
          <div className="grid grid-cols-2 gap-1 px-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="size-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            ))}
          </div>
        </div>

        <div
          {...attributes}
          {...listeners}
          className="absolute left-1 top-1/2 -translate-y-1/2 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100"
        >
          <div className="grid grid-cols-2 gap-1 px-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="size-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            ))}
          </div>
        </div>

        {/* TIME & ICON GROUP */}
        <div className="flex flex-col items-center gap-2 shrink-0 ml-2">
          <div className={`size-12 rounded-2xl flex items-center justify-center transition-all duration-500 ${
            completed 
              ? "bg-slate-200 dark:bg-slate-800 text-slate-400" 
              : `${CATEGORY_STYLES[activity.category].bg} ${CATEGORY_STYLES[activity.category].color} shadow-sm group-hover:scale-110`
          }`}>
            {(() => {
              const Icon = CATEGORY_STYLES[activity.category].icon;
              return <Icon size={24} strokeWidth={2.5} />;
            })()}
          </div>
          
          {isEditingTime ? (
            <input
              type="time"
              autoFocus
              defaultValue={activity.time}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                patchActivity(dayId, activity.id, { time: e.target.value });
                setIsEditingTime(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  patchActivity(dayId, activity.id, { time: (e.target as HTMLInputElement).value });
                  setIsEditingTime(false);
                }
              }}
              className="w-16 text-[10px] font-black text-center bg-white dark:bg-slate-800 border-none rounded-lg p-1 shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingTime(true);
              }}
              className={`text-[11px] font-black tracking-tighter tabular-nums transition-colors ${
                completed ? "text-slate-400" : "text-slate-900 dark:text-slate-100 hover:text-indigo-600"
              }`}
            >
              {activity.time}
            </button>
          )}
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 min-w-0 py-1" onClick={() => setIsExpanded(!isExpanded)}>
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
            <MapPin size={12} className={completed ? "text-slate-300" : "text-slate-400"} />
            <span className={`text-xs font-medium truncate ${completed ? "text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>
              {activity.location || "Location pending"}
            </span>
          </div>
        </div>

        {/* SATISFYING ACTION GROUP */}
        <div className="flex items-center gap-1">
           <button
             onPointerDown={(e) => e.stopPropagation()}
             onClick={(e) => {
               e.stopPropagation();
               removeActivity(dayId, activity.id);
             }}
             className="size-8 flex items-center justify-center text-slate-300 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl transition-all"
             title="Delete"
           >
             <Trash2 size={16} />
           </button>

           <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              duplicate(dayId, activity.id);
            }}
            className="size-8 flex items-center justify-center text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 rounded-xl transition-all opacity-0 group-hover:opacity-100"
            title="Duplicate"
          >
            <Plus size={18} />
          </button>
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              updateState(dayId, activity.id, completed ? "pending" : "completed");
            }}
            className={`size-10 rounded-2xl flex items-center justify-center transition-all duration-500 border-2 ${
              completed 
                ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                : "border-slate-200 dark:border-slate-800 hover:border-indigo-500 hover:scale-110"
            }`}
          >
            <CheckCircle2 size={20} strokeWidth={completed ? 3 : 2} className={completed ? "scale-110" : "text-slate-200"} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/20 backdrop-blur-md"
          >
            <div className="p-6 space-y-8">
              {/* STATS STRIP */}
              <div className="grid grid-cols-2 gap-4 pb-4">
                <div className="flex flex-col gap-1 p-3 rounded-2xl bg-white dark:bg-slate-900 shadow-sm">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <Clock3 size={12} /> Duration
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={activity.durationMin}
                      onChange={(e) => patchActivity(dayId, activity.id, { durationMin: parseInt(e.target.value) })}
                      className="w-full bg-transparent border-none p-0 text-sm font-black focus:ring-0"
                    />
                    <span className="text-[10px] font-black text-slate-300">MINS</span>
                  </div>
                </div>
                
                <div className="flex flex-col gap-1 p-3 rounded-2xl bg-white dark:bg-slate-900 shadow-sm">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <CreditCard size={12} /> Est. Cost
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-300">$</span>
                    <input
                      type="number"
                      value={activity.expectedCost || 0}
                      onChange={(e) => patchActivity(dayId, activity.id, { expectedCost: parseFloat(e.target.value) })}
                      className="w-full bg-transparent border-none p-0 text-sm font-black focus:ring-0"
                    />
                  </div>
                </div>
              </div>

              {/* LOCATION BLOCK */}
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <MapPin size={12} /> Adventure Spot
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={activity.location || ""}
                    placeholder="Where is the magic?..."
                    onChange={(e) => patchActivity(dayId, activity.id, { location: e.target.value })}
                    className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                  />
                  {activity.mapsUrl && (
                    <a
                      href={activity.mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="size-12 flex items-center justify-center bg-indigo-600 text-white rounded-2xl shadow-xl shadow-indigo-500/20 hover:bg-indigo-700 hover:scale-110 active:scale-95 transition-all"
                    >
                      <ExternalLink size={20} />
                    </a>
                  )}
                </div>
              </div>

              {/* NOTES / CONTEXT */}
              <div className="space-y-4">
                 <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <FileText size={12} /> Traveler Notes
                    </label>
                    <Sparkles size={14} className="text-indigo-400" />
                 </div>
                 <div className="relative">
                    <div className="absolute top-4 left-4 size-8 flex items-center justify-center bg-indigo-50 dark:bg-indigo-900/30 rounded-xl pointer-events-none">
                      <Bot size={16} className="text-indigo-600" />
                    </div>
                    <textarea
                      value={activity.notes || ""}
                      placeholder="Special instructions, what to eat, or a note for your future self..."
                      onChange={(e) => patchActivity(dayId, activity.id, { notes: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] pl-16 pr-6 py-6 text-sm font-medium min-h-[160px] focus:ring-2 focus:ring-indigo-500 transition-all resize-none shadow-sm leading-relaxed"
                    />
                 </div>
              </div>

              {/* DANGER ZONE - Clear Mobile Action */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log("Plania: Internal Delete clicked", { dayId, activityId: activity.id });
                    removeActivity(dayId, activity.id);
                  }}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all border border-rose-100/50 active:scale-95"
                >
                  <Trash2 size={14} />
                  Delete Activity
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
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
    removeActivity
  } = useItineraryStore();

  const [showAdd, setShowAdd] = useState(false);
  const [importText, setImportText] = useState("");
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

    // 1. Reorder in store
    reorderActivities(activeDayId, String(active.id), String(over.id));

    // 2. Intelligent Auto-Time Calculation
    const movedId = String(active.id);
    const dayActivities = activeDay.activities;
    const oldIndex = dayActivities.findIndex((a) => a.id === movedId);
    
    // We get the view order (sortedActivities) to see who the new neighbors are
    const currentOrder = sortedActivities;
    const oldViewIndex = currentOrder.findIndex(a => a.id === movedId);
    const overViewIndex = currentOrder.findIndex(a => a.id === over.id);

    // Calculate new neighbors in the view
    // Since reorderActivities just moved it in the store, we need to find its new position.
    // However, it's easier to calculate based on the "over" target.
    
    let newTime = "";
    if (overViewIndex === 0) {
      // Dropped at the top
      newTime = addMinutes(currentOrder[1].time, -30);
    } else if (overViewIndex === currentOrder.length - 1) {
      // Dropped at the bottom
      newTime = addMinutes(currentOrder[currentOrder.length - 2].time, 30);
    } else {
      // Dropped between two items or after/before another
      // This is a bit tricky with dnd-kit's default behavior, but usually:
      const prev = currentOrder[overViewIndex - 1];
      const next = currentOrder[overViewIndex];
      newTime = getMidpointTime(prev.time, next.time);
    }

    if (newTime) {
      patchActivity(activeDayId, movedId, { time: newTime });
    }
  };

  const today = format(new Date(), "yyyy-MM-dd");
  const jumpToToday = () => {
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

  if (!isMounted || !trip) return null;

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
             
             <button 
                onClick={jumpToToday}
                className="px-4 py-2 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-100/50"
             >
                Today
             </button>
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

                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={activeDayId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.4 }}
                    className="space-y-6"
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
            
            <h3 className="text-lg font-black text-white dark:text-slate-900 mb-6 flex items-center gap-3">
              <CreditCard className="text-indigo-400" size={24} />
              Reservations
            </h3>

            <div className="space-y-4 relative z-10">
              {trip.criticalReservations.map((booking) => {
                const isBooked = booking.status === "booked";
                return (
                  <div
                    key={booking.id}
                    className={`rounded-2xl p-4 transition-all border ${
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
              className="w-full rounded-[1.5rem] bg-slate-900 dark:bg-white px-5 py-4 text-xs font-black text-white dark:text-slate-900 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl tracking-widest uppercase"
              onClick={() => {
                const parsed = parseItineraryText(importText, activeDayId);
                addImportedActivities(activeDayId, parsed.activities);
                setImportText("");
              }}
            >
              Sync to Timeline
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
                      id: `activity-${Date.now()}`,
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
    </main>
  );
}
