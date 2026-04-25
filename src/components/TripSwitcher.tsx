"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { useI18n } from "@/components/I18nProvider";
import { ChevronDown, Plus, Trash2, Calendar, MapPin, Loader2, Check } from "lucide-react";

export function TripSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const { trips, activeTrip, fetchAllTrips, switchTrip, createTrip, deleteTrip, loading } = useItineraryStore();
  const { t } = useI18n();
  const [todayStr, setTodayStr] = useState("");

  useEffect(() => {
    setTodayStr(new Date().toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    fetchAllTrips();
  }, [fetchAllTrips]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await createTrip(newName, newStartDate || undefined, newEndDate || undefined);
    setNewName("");
    setNewStartDate("");
    setNewEndDate("");
    setShowCreate(false);
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-500/50 transition-all group"
      >
        <div className="flex flex-col items-start">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current Trip</span>
          <span className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1 max-w-[150px]">
            {activeTrip?.name || "Select a Trip"}
          </span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute top-full mt-2 right-0 w-72 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 z-[60] overflow-hidden"
            >
              <div className="p-2 space-y-1 max-h-80 overflow-y-auto">
                {trips.map((t) => (
                  <div key={t.id} className="group relative">
                    <button
                      onClick={() => {
                        switchTrip(t.id);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all ${
                        activeTrip?.id === t.id 
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800' 
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'
                      }`}
                    >
                      <div className={`size-8 rounded-xl flex items-center justify-center ${
                        activeTrip?.id === t.id ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                      }`}>
                        {activeTrip?.id === t.id ? <Check size={16} /> : <MapPin size={16} />}
                      </div>
                      <div className="flex flex-col items-start overflow-hidden">
                        <span className={`text-sm font-bold truncate w-full ${activeTrip?.id === t.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}>
                          {t.name}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">
                          {t.dayCount} days • {t.activityCount} activities
                        </span>
                      </div>
                    </button>
                    {trips.length > 1 && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Are you sure you want to delete this trip?")) {
                            deleteTrip(t.id);
                          }
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                {showCreate ? (
                  <form onSubmit={handleCreate} className="p-2 space-y-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Trip Name (e.g. Japan 2026)"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Start Date</label>
                        <input
                          type="date"
                          min={todayStr}
                          value={newStartDate}
                          onChange={(e) => setNewStartDate(e.target.value)}
                          onClick={(e) => (e.currentTarget as any).showPicker?.()}
                          className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-1">End Date</label>
                        <input
                          type="date"
                          min={newStartDate || todayStr}
                          value={newEndDate}
                          onChange={(e) => setNewEndDate(e.target.value)}
                          onClick={(e) => (e.currentTarget as any).showPicker?.()}
                          className="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        type="submit"
                        disabled={loading}
                        className="flex-1 bg-indigo-600 text-white py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="animate-spin mx-auto" size={14} /> : 'Create'}
                      </button>
                      <button 
                        type="button"
                        onClick={() => setShowCreate(false)}
                        className="px-4 py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button 
                    onClick={() => setShowCreate(true)}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all font-bold text-sm"
                  >
                    <Plus size={18} />
                    Create New Trip
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
