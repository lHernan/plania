"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, Check, Loader2, MapPin, Plus, Star, Trash2, X } from "lucide-react";
import { getCurrentDateString, resolveTripSelectionFromSummaries } from "@/lib/trip-selection";
import { useItineraryStore } from "@/store/use-itinerary-store";

function isTripSummary(trip: ReturnType<typeof useItineraryStore.getState>["trips"][number] | undefined): trip is ReturnType<typeof useItineraryStore.getState>["trips"][number] {
  return Boolean(trip);
}

export function TripSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showPastTrips, setShowPastTrips] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const todayStr = getCurrentDateString();

  const {
    trips,
    activeTrip,
    fetchAllTrips,
    switchTrip,
    createTrip,
    deleteTrip,
    setTripFavorite,
    loading,
  } = useItineraryStore();

  useEffect(() => {
    fetchAllTrips();
  }, [fetchAllTrips]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const tripSelection = useMemo(
    () => resolveTripSelectionFromSummaries(todayStr, trips),
    [todayStr, trips]
  );

  const groupedTrips = useMemo(() => ({
    active: tripSelection.groups.active
      .map((trip) => trips.find((summary) => summary.id === trip.id))
      .filter(isTripSummary),
    upcoming: tripSelection.groups.upcoming
      .map((trip) => trips.find((summary) => summary.id === trip.id))
      .filter(isTripSummary),
    past: tripSelection.groups.past
      .map((trip) => trips.find((summary) => summary.id === trip.id))
      .filter(isTripSummary),
  }), [tripSelection.groups.active, tripSelection.groups.past, tripSelection.groups.upcoming, trips]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    await createTrip(newName, newStartDate || undefined, newEndDate || undefined);
    setNewName("");
    setNewStartDate("");
    setNewEndDate("");
    setShowCreate(false);
    setIsOpen(false);
  };

  const renderTripRow = (
    trip: (typeof trips)[number],
    timing: "active" | "upcoming" | "past"
  ) => {
    const isCurrentTrip = activeTrip?.id === trip.id;
    const timingBadge = timing === "active"
      ? tripSelection.ui.badges.active
      : timing === "past"
        ? tripSelection.ui.badges.past
        : null;

    return (
      <div key={trip.id} className="relative group">
        <button
          onClick={() => {
            switchTrip(trip.id);
            setIsOpen(false);
            setShowCreate(false);
          }}
          className={`w-full flex items-center gap-3 px-4 pr-28 py-3.5 rounded-2xl transition-all text-left ios-compact-row ios-compact-gap ${
            isCurrentTrip
              ? "bg-indigo-500 shadow-lg shadow-indigo-500/20"
              : "bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <div className={`size-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isCurrentTrip ? "bg-white/20 text-white" : "bg-white dark:bg-slate-800 text-slate-400"
          }`}>
            {isCurrentTrip ? <Check size={18} /> : <MapPin size={18} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className={`text-sm font-bold truncate ios-compact-title ${isCurrentTrip ? "text-white" : "text-slate-900 dark:text-white"}`}>
                {trip.name}
              </p>
              {timingBadge ? (
                <span className={`text-[10px] font-black ios-compact-meta ${isCurrentTrip ? "text-white/80" : "text-slate-400"}`}>
                  {timingBadge}
                </span>
              ) : null}
            </div>
            <p className={`text-[10px] font-medium mt-0.5 ios-compact-meta ${isCurrentTrip ? "text-white/70" : "text-slate-400"}`}>
              {trip.dayCount} days / {trip.activityCount} activities
            </p>
          </div>
        </button>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <motion.button
            whileTap={{ scale: 0.9 }}
            animate={{ scale: trip.isFavorite ? 1.06 : 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={async (e) => {
              e.stopPropagation();
              setFavoriteBusyId(trip.id);
              await setTripFavorite(trip.id);
              setFavoriteBusyId((current) => (current === trip.id ? null : current));
            }}
            disabled={favoriteBusyId === trip.id}
            className={`flex size-11 items-center justify-center rounded-full transition-all ${
              isCurrentTrip
                ? "text-white hover:bg-white/10"
                : trip.isFavorite
                  ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  : "text-slate-300 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            } ${favoriteBusyId === trip.id ? "opacity-70" : ""}`}
            aria-label={trip.isFavorite ? "Remove favorite trip" : "Set favorite trip"}
            title={trip.isFavorite ? "Remove favorite trip" : "Set favorite trip"}
          >
            <Star size={18} className={trip.isFavorite ? "fill-current" : ""} />
          </motion.button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Delete this trip?")) deleteTrip(trip.id);
            }}
            className={`flex size-11 items-center justify-center rounded-full transition-all ${
              isCurrentTrip
                ? "text-white/50 hover:text-white hover:bg-white/10"
                : "text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            }`}
            aria-label="Delete trip"
            title="Delete trip"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  };

  const sheet = (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200]"
            onClick={() => {
              setIsOpen(false);
              setShowCreate(false);
            }}
          />

          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-[210] bg-white dark:bg-slate-950 rounded-t-3xl flex flex-col ios-compact-shell"
            style={{ maxHeight: "85dvh" }}
          >
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0 ios-compact-row">
              <div>
                <span className="block text-sm font-black text-slate-900 dark:text-white tracking-tight ios-compact-title">My Trips</span>
                {tripSelection.ui.hints.default_selection_label ? (
                  <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mt-1 ios-compact-meta">
                    {tripSelection.ui.hints.default_selection_label}
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setShowCreate(false);
                }}
                className="size-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-4 min-h-0">
              {trips.length === 0 && !loading ? (
                <div className="py-10 text-center">
                  <MapPin size={28} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    {tripSelection.ui.hints.empty_state ?? "No trips yet"}
                  </p>
                </div>
              ) : null}

              {tripSelection.ui.sections[0].visible ? (
                <section className="space-y-1.5">
                  <p className="px-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 ios-compact-meta">
                    {tripSelection.ui.sections[0].title}
                  </p>
                  {groupedTrips.active.map((trip) => renderTripRow(trip, "active"))}
                </section>
              ) : null}

              {tripSelection.ui.sections[1].visible ? (
                <section className="space-y-1.5">
                  <p className="px-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 ios-compact-meta">
                    {tripSelection.ui.sections[1].title}
                  </p>
                  {groupedTrips.upcoming.map((trip) => renderTripRow(trip, "upcoming"))}
                </section>
              ) : null}

              {tripSelection.ui.sections[2].visible ? (
                <section className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPastTrips((current) => !current)}
                    className="w-full px-1 flex items-center justify-between text-left"
                  >
                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 ios-compact-meta">
                      {tripSelection.ui.sections[2].title}
                    </span>
                    <ChevronRight
                      size={14}
                      className={`text-slate-400 transition-transform ${showPastTrips ? "rotate-90" : ""}`}
                    />
                  </button>
                  {showPastTrips ? groupedTrips.past.map((trip) => renderTripRow(trip, "past")) : null}
                </section>
              ) : null}
            </div>

            <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-800 px-4 pt-3 pb-8">
              {showCreate ? (
                <form onSubmit={handleCreate} className="space-y-3">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Trip name, e.g. Tokyo 2026"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1 mb-1 block">Start</label>
                      <input
                        type="date"
                        min={todayStr}
                        value={newStartDate}
                        onChange={(e) => setNewStartDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1 mb-1 block">End</label>
                      <input
                        type="date"
                        min={newStartDate || todayStr}
                        value={newEndDate}
                        onChange={(e) => setNewEndDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={loading || !newName.trim()}
                      className="flex-1 bg-indigo-600 text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 size={14} className="animate-spin" /> : "Create Trip"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="px-5 py-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-dashed border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-widest hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all"
                >
                  <Plus size={16} />
                  New Trip
                </button>
              )}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 max-w-[180px] md:max-w-[220px]"
      >
        <div className="flex flex-col items-start min-w-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none mb-0.5 ios-compact-meta">Current Trip</span>
          <span className="text-sm font-black text-slate-900 dark:text-white truncate max-w-[140px] md:max-w-[180px] leading-tight ios-compact-title">
            {activeTrip?.name ?? "Select a Trip"}
          </span>
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {typeof document !== "undefined" ? createPortal(sheet, document.body) : null}
    </div>
  );
}
