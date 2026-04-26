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

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    setTodayStr(new Date().toISOString().split('T')[0]);
    return () => window.removeEventListener('resize', checkMobile);
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
        className="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-500/50 transition-all group"
      >
        <div className="flex flex-col items-start">
          <span className="text-[8px] md:text-[10px] font-black uppercase tracking-widest text-slate-400">Current Trip</span>
          <span className="text-xs md:text-sm font-bold text-slate-900 dark:text-white line-clamp-1 max-w-[120px] md:max-w-[150px]">
            {activeTrip?.name || "Select a Trip"}
          </span>
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[100]" 
              onClick={() => setIsOpen(false)} 
            />
            <motion.div
              initial={isMobile ? { y: "100%" } : { opacity: 0, y: 10, scale: 0.95 }}
              animate={isMobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
              exit={isMobile ? { y: "100%" } : { opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className={`z-[110] overflow-hidden ${
                isMobile 
                  ? "fixed inset-x-0 bottom-0 bg-white dark:bg-slate-950 rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.2)] max-h-[90vh] flex flex-col" 
                  : "absolute top-full mt-2 right-0 w-80 bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800"
              }`}
            >
              {isMobile && (
                <div className="flex justify-center pt-4 pb-2 cursor-grab active:cursor-grabbing">
                  <div className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" />
                </div>
              )}

              <div className="p-2 border-b border-slate-50 dark:border-slate-800/50 flex items-center justify-between px-6 py-4 md:hidden">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Your Adventures</h3>
                <button onClick={() => setIsOpen(false)} className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Done</button>
              </div>

              <div className={`p-2 space-y-1 overflow-y-auto overscroll-contain ${isMobile ? "max-h-[50vh]" : "max-h-80"}`}>
                {trips.length === 0 && (
                  <div className="p-8 text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No trips found</p>
                  </div>
                )}
                {trips.map((t) => (
                  <div key={t.id} className="group relative">
                    <button
                      onClick={() => {
                        switchTrip(t.id);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center gap-4 p-4 md:p-3 rounded-2xl transition-all ${
                        activeTrip?.id === t.id 
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800' 
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'
                      }`}
                    >
                      <div className={`size-10 md:size-9 rounded-xl flex items-center justify-center ${
                        activeTrip?.id === t.id ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                      }`}>
                        {activeTrip?.id === t.id ? <Check size={20} /> : <MapPin size={20} />}
                      </div>
                      <div className="flex flex-col items-start overflow-hidden text-left flex-1">
                        <span className={`text-sm md:text-sm font-bold truncate w-full ${activeTrip?.id === t.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}>
                          {t.name}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400">
                          {t.dayCount} days • {t.activityCount} activities
                        </span>
                      </div>
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Are you sure you want to delete this trip?")) {
                          deleteTrip(t.id);
                        }
                      }}
                      className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-rose-500 transition-all ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className={`p-4 md:p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 pb-safe ${isMobile ? "pb-12" : ""}`}>
                {showCreate ? (
                  <form onSubmit={handleCreate} className="space-y-4 md:space-y-2">
                    <div className="space-y-1">
                      <label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 ml-1">New Adventure Name</label>
                      <input
                        autoFocus
                        type="text"
                        placeholder="e.g. Japan 2026"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full px-4 py-4 md:px-3 md:py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 ml-1">Start</label>
                        <input
                          type="date"
                          min={todayStr}
                          value={newStartDate}
                          onChange={(e) => setNewStartDate(e.target.value)}
                          className="w-full px-3 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 ml-1">End</label>
                        <input
                          type="date"
                          min={newStartDate || todayStr}
                          value={newEndDate}
                          onChange={(e) => setNewEndDate(e.target.value)}
                          className="w-full px-3 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2 md:pt-0">
                      <button 
                        type="submit"
                        disabled={loading || !newName.trim()}
                        className="flex-1 bg-indigo-600 text-white py-4 md:py-3 rounded-2xl md:rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-2"
                      >
                        {loading ? <Loader2 className="animate-spin" size={14} /> : (
                          <>
                            <Plus size={14} />
                            Create Trip
                          </>
                        )}
                      </button>
                      <button 
                        type="button"
                        onClick={() => setShowCreate(false)}
                        className="px-6 py-4 md:py-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold uppercase tracking-widest"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button 
                    onClick={() => setShowCreate(true)}
                    className="w-full flex items-center justify-center gap-2 p-5 md:p-3 rounded-2xl text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all font-black text-xs uppercase tracking-[0.2em] border border-dashed border-indigo-200 dark:border-indigo-800"
                  >
                    <Plus size={18} />
                    Add Another Trip
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
