"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Plane, ArrowRight, CheckCircle2, Copy, LayoutTemplate, Plus, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { AuthModal } from "@/components/AuthModal";
import { useI18n } from "@/components/I18nProvider";
import { format } from "date-fns";
import { TRIP_TEMPLATES, TripTemplate } from "@/lib/trip-templates";

export default function Home() {
  const { t } = useI18n();
  const { user, signOut } = useAuthStore();
  const { createTrip, loadTemplate, saveDraft, loading, activeTrip, hasFetched, activeTripIsDraft } = useItineraryStore();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [quickTripName, setQuickTripName] = useState("");
  const [quickTripStart, setQuickTripStart] = useState("");
  const [quickTripEnd, setQuickTripEnd] = useState("");
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => { setIsMounted(true); }, []);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleClone = (template: TripTemplate) => {
    loadTemplate(template.plan);
    showToast(t("landing_template_loaded"));
  };

  const handleQuickCreate = () => {
    if (quickTripName.trim()) {
      createTrip(quickTripName, quickTripStart || undefined, quickTripEnd || undefined);
      setShowQuickStart(false);
    } else {
      alert(t("landing_enter_trip_name"));
    }
  };

  if (!isMounted || (loading && !hasFetched)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest" suppressHydrationWarning>{t("landing_loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8 overflow-hidden relative">
      {/* Top bar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {user && !user.is_anonymous && (
          <button
            onClick={() => void signOut()}
            className="bg-white/80 dark:bg-slate-900/80 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-rose-500 transition-colors min-h-[36px]"
          >
            {t("logout")}
          </button>
        )}
      </div>

      {/* Background blobs */}
      <div className="absolute top-[-10%] left-[-10%] size-64 md:size-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] size-64 md:size-96 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10 space-y-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4 pt-6"
        >
          <div className="size-16 md:size-20 bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl flex items-center justify-center mx-auto ring-8 ring-slate-100/50 dark:ring-slate-800/30 border border-white/20">
            <Sparkles className="text-indigo-500 animate-pulse" size={32} />
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight">{t("landing_title")}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base font-medium px-4 leading-relaxed max-w-2xl mx-auto">
            {t("landing_tagline")}
          </p>
        </motion.div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => setShowQuickStart(true)}
            className="px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all min-h-[44px]"
          >
            <Plus size={16} /> {t("landing_create_from_scratch")}
          </button>
          {user?.is_anonymous && (
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-6 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-all min-h-[44px]"
            >
              {t("landing_sign_in_sync")}
            </button>
          )}
        </div>

        {/* Example trips */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <LayoutTemplate size={16} className="text-indigo-500" />
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500">{t("landing_examples_title")}</h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{t("landing_examples_subtitle")}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TRIP_TEMPLATES.map((tpl) => (
              <motion.div
                key={tpl.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-2 border-indigo-500/10 rounded-3xl p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-2xl">
                    {tpl.coverEmoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">{tpl.name}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{tpl.durationDays} días</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed flex-1">{tpl.description}</p>
                <button
                  onClick={() => handleClone(tpl)}
                  disabled={cloningId === tpl.id}
                  className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2 min-h-[40px]"
                >
                  {cloningId === tpl.id ? <Loader2 size={14} className="animate-spin" /> : null}
                  {t("landing_use_template")}
                </button>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Auth section */}
        {user && !user.is_anonymous && (
          <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100/50 dark:border-indigo-800/50 text-center">
            <p className="text-[10px] font-bold text-slate-500 leading-tight">
              <CheckCircle2 size={12} className="inline mr-2 text-indigo-500" />
              {t("landing_logged_in_as", { email: user.email ?? "" })}
            </p>
          </div>
        )}
      </div>

      {/* Quick start modal */}
      <AnimatePresence>
        {showQuickStart && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md"
            onClick={() => setShowQuickStart(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl p-8 space-y-5"
            >
              <h2 className="text-2xl font-black text-slate-900 dark:text-white">{t("landing_quick_start")}</h2>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder={t("landing_trip_name_placeholder")}
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-6 text-base font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600 min-h-[48px]"
                  value={quickTripName}
                  onChange={(e) => setQuickTripName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    min={today}
                    className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-4 text-base font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[48px]"
                    value={quickTripStart}
                    onChange={(e) => setQuickTripStart(e.target.value)}
                  />
                  <input
                    type="date"
                    min={quickTripStart || today}
                    className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-4 text-base font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[48px]"
                    value={quickTripEnd}
                    onChange={(e) => setQuickTripEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowQuickStart(false)}
                  className="flex-1 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 min-h-[44px]"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={handleQuickCreate}
                  disabled={loading}
                  className="flex-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-3 rounded-2xl font-black text-xs uppercase tracking-[0.2em] min-h-[44px] disabled:opacity-60"
                >
                  {loading ? t("landing_creating") : t("landing_create_adventure")}
                </button>
              </div>
            </motion.div>
          </motion.div>
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
