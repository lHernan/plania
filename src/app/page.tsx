"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Plane, ArrowRight, CheckCircle2 } from "lucide-react";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { AuthModal } from "@/components/AuthModal";
import { useI18n } from "@/components/I18nProvider";
import { format } from "date-fns";

/**
 * Landing / Onboarding page — shown when user has no active trip.
 * AuthInitializer (in layout) will push to /trips once a trip is ready.
 */
export default function Home() {
  const { t } = useI18n();
  const { user } = useAuthStore();
  const { createTrip, loading, activeTrip, hasFetched } = useItineraryStore();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [quickTripName, setQuickTripName] = useState("");
  const [quickTripStart, setQuickTripStart] = useState("");
  const [quickTripEnd, setQuickTripEnd] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => { setIsMounted(true); }, []);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Show loading spinner while data is being fetched (avoids flashing welcome on logged-in reload)
  if (!isMounted || (loading && !hasFetched)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 md:p-6 overflow-hidden relative">
      {/* Background blobs */}
      <div className="absolute top-[-10%] left-[-10%] size-64 md:size-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] size-64 md:size-96 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full relative z-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-6 mb-10"
        >
          <div className="size-20 md:size-24 bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl flex items-center justify-center mx-auto ring-8 ring-slate-100/50 dark:ring-slate-800/30 border border-white/20">
            <Sparkles className="text-indigo-500 animate-pulse" size={36} />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight">Plania</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium px-8 leading-relaxed">
              Your premium adventure starts here. Plan, sync, and explore with AI precision.
            </p>
          </div>
        </motion.div>

        {/* Quick Start Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-2 border-indigo-500/10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] rounded-[3rem] p-6 md:p-8"
        >
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500">Quick Start</h2>
            <Plane size={16} className="text-slate-200 dark:text-slate-800" />
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Trip Name</label>
              <input
                type="text"
                placeholder="e.g. My Japan Escape 2026"
                className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-6 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600"
                value={quickTripName}
                onChange={(e) => setQuickTripName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Start Date</label>
                <input
                  type="date"
                  min={today}
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-4 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  value={quickTripStart}
                  onChange={(e) => setQuickTripStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">End Date</label>
                <input
                  type="date"
                  min={quickTripStart || today}
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-4 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  value={quickTripEnd}
                  onChange={(e) => setQuickTripEnd(e.target.value)}
                />
              </div>
            </div>

            <button
              disabled={loading}
              onClick={() => {
                if (quickTripName.trim()) {
                  createTrip(quickTripName, quickTripStart || undefined, quickTripEnd || undefined);
                } else {
                  alert("Please enter a trip name");
                }
              }}
              className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 group disabled:opacity-60"
            >
              {loading ? "Creating…" : "Create Adventure"}
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </motion.div>

        {/* Auth section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-10 text-center"
        >
          {user?.is_anonymous ? (
            <div className="space-y-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                Already have an account?
              </p>
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-8 py-3 rounded-full border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-all shadow-sm"
              >
                Sign In to Sync
              </button>
            </div>
          ) : user ? (
            <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100/50 dark:border-indigo-800/50">
              <p className="text-[10px] font-bold text-slate-500 leading-tight">
                <CheckCircle2 size={12} className="inline mr-2 text-indigo-500" />
                Logged in as <span className="text-indigo-600">{user.email}</span>
                {hasFetched && " · No trips yet — create one above!"}
              </p>
            </div>
          ) : null}
        </motion.div>
      </div>

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
            className={`fixed bottom-10 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl z-[110] font-bold text-[10px] uppercase tracking-widest ${
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
