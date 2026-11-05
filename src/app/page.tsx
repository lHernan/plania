"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, LayoutTemplate, Plus, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { AuthModal, type AuthReason } from "@/components/AuthModal";
import { useI18n } from "@/components/I18nProvider";
import { ImageSlot, LANDING_IMAGES } from "@/components/landing/ImageSlot";
import { PlanField } from "@/components/landing/PlanField";
import { TachiIntro, ValueBlocks } from "@/components/landing/ValueBlocks";
import { format } from "date-fns";
import { TRIP_TEMPLATES, TripTemplate } from "@/lib/trip-templates";
import { buildDraftTrip, newDraftId, plannedDates, defaultPlannerForm } from "@/lib/planner/form";

export default function Home() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const { createTrip, loadTemplate, loading, hasFetched } = useItineraryStore();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authReason, setAuthReason] = useState<AuthReason | undefined>(undefined);
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

  const openAuth = (reason?: AuthReason) => {
    setAuthReason(reason);
    setShowAuthModal(true);
  };

  // A registered user creates a real trip; without an account it is a draft, like a template,
  // and saving it asks for the account.
  const handleQuickCreate = () => {
    const name = quickTripName.trim();
    if (!name) {
      alert(t("landing_enter_trip_name"));
      return;
    }
    if (user && !user.is_anonymous) {
      void createTrip(name, quickTripStart || undefined, quickTripEnd || undefined);
    } else {
      const startDate = quickTripStart || today;
      const dates = plannedDates({ ...defaultPlannerForm(), mode: "dates", startDate, endDate: quickTripEnd || startDate });
      loadTemplate(buildDraftTrip({ id: newDraftId(), name, destinations: [], dates, userId: user?.id }));
    }
    setShowQuickStart(false);
  };

  if (!isMounted || (loading && !hasFetched)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-[var(--color-primary)]/20 border-t-[var(--color-primary)] rounded-full animate-spin" />
          <p className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest" suppressHydrationWarning>{t("landing_loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] p-4 md:p-8 overflow-hidden relative">
      {/* Top bar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        {user && !user.is_anonymous && (
          <Link
            href="/trips"
            className="bg-[var(--color-surface)]/80 backdrop-blur border border-[var(--color-border)] rounded-full px-3 py-2 text-xs font-bold text-[var(--color-primary)] min-h-[36px] flex items-center"
          >
            {t("account_menu_my_trips")}
          </Link>
        )}
        {user && !user.is_anonymous && (
          <button
            onClick={() => void signOut()}
            className="bg-[var(--color-surface)]/80 backdrop-blur border border-[var(--color-border)] rounded-full px-3 py-2 text-xs font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] transition-colors min-h-[36px]"
          >
            {t("logout")}
          </button>
        )}
      </div>

      {/* Background blobs */}
      <div className="absolute top-[-10%] left-[-10%] size-64 md:size-96 bg-[var(--color-primary)]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] size-64 md:size-96 bg-[var(--color-warning)]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10 space-y-10">
        {/* Hero: claim and planning field first, so on a phone the destination is visible without scrolling. */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid items-center gap-6 pt-6 md:grid-cols-2 md:gap-10"
        >
          <div className="space-y-4">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-[var(--color-primary)]">{t("landing_title")}</p>
            <h1 className="text-3xl md:text-5xl font-black text-[var(--color-text)] tracking-tight font-[family-name:var(--font-display)]">{t("landing_claim")}</h1>
            <p className="text-[var(--color-text-secondary)] text-sm md:text-base font-medium leading-relaxed">
              {t("landing_hero_subtitle")}
            </p>
            <PlanField />
          </div>
          <ImageSlot src={LANDING_IMAGES.hero} alt={t("landing_hero_image_alt")} priority className="hidden h-[420px] rounded-[2rem] md:block" />
        </motion.section>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => setShowQuickStart(true)}
            className="px-6 py-3 bg-[var(--color-surface)] text-[var(--color-primary)] border border-[var(--color-primary)]/30 rounded-2xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-[var(--color-primary-subtle)] transition-all min-h-[44px]"
          >
            <Plus size={16} /> {t("landing_create_from_scratch")}
          </button>
          {(!user || user.is_anonymous) && (
            <button
              onClick={() => openAuth()}
              className="px-6 py-3 rounded-2xl border border-[var(--color-border)] text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] transition-all min-h-[44px]"
            >
              {t("landing_sign_in_sync")}
            </button>
          )}
        </div>

        <ValueBlocks />

        {/* Registered users go straight to planning with Tachi; guests are asked to sign in first. */}
        <TachiIntro onAsk={() => (user && !user.is_anonymous ? router.push("/plan") : openAuth("tachi"))} />

        {/* Example trips */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <LayoutTemplate size={16} className="text-[var(--color-primary)]" />
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-[var(--color-primary)]">{t("landing_examples_title")}</h2>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] font-medium">{t("landing_examples_subtitle")}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TRIP_TEMPLATES.map((tpl) => (
              <motion.div
                key={tpl.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[var(--color-surface)]/80 backdrop-blur-xl border-2 border-[var(--color-primary)]/10 rounded-3xl p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-2xl bg-[var(--color-primary-subtle)] flex items-center justify-center text-2xl">
                    {tpl.coverEmoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-black text-[var(--color-text)] truncate">{tpl.name}</h3>
                    <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">{tpl.durationDays} días</p>
                  </div>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed flex-1">{tpl.description}</p>
                <button
                  onClick={() => handleClone(tpl)}
                  disabled={cloningId === tpl.id}
                  className="w-full bg-[var(--color-primary)] text-white py-3 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-[var(--color-primary-hover)] active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2 min-h-[40px]"
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
          <div className="p-4 rounded-2xl bg-[var(--color-primary-subtle)]/50 border border-[var(--color-primary)]/20 text-center">
            <p className="text-[10px] font-bold text-[var(--color-text-secondary)] leading-tight">
              <CheckCircle2 size={12} className="inline mr-2 text-[var(--color-primary)]" />
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
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-[var(--color-text)]/60 backdrop-blur-md"
            onClick={() => setShowQuickStart(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t("landing_quick_start")}
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[var(--color-surface)] rounded-2xl shadow-2xl p-8 space-y-5"
            >
              <h2 className="text-2xl font-black text-[var(--color-text)] font-[family-name:var(--font-display)]">{t("landing_quick_start")}</h2>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder={t("landing_trip_name_placeholder")}
                  className="w-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-2xl py-4 px-6 text-base font-bold focus:ring-2 focus:ring-[var(--color-primary)]/30 outline-none transition-all placeholder:text-[var(--color-text-muted)] min-h-[48px]"
                  value={quickTripName}
                  onChange={(e) => setQuickTripName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    aria-label={t("landing_start_date")}
                    min={today}
                    className="w-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-2xl py-4 px-4 text-base font-bold focus:ring-2 focus:ring-[var(--color-primary)]/30 outline-none transition-all min-h-[48px]"
                    value={quickTripStart}
                    onChange={(e) => setQuickTripStart(e.target.value)}
                  />
                  <input
                    type="date"
                    aria-label={t("landing_end_date")}
                    min={quickTripStart || today}
                    className="w-full bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-2xl py-4 px-4 text-base font-bold focus:ring-2 focus:ring-[var(--color-primary)]/30 outline-none transition-all min-h-[48px]"
                    value={quickTripEnd}
                    onChange={(e) => setQuickTripEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowQuickStart(false)}
                  className="flex-1 py-3 rounded-2xl border border-[var(--color-border)] text-xs font-bold text-[var(--color-text-secondary)] min-h-[44px]"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={handleQuickCreate}
                  disabled={loading}
                  className="flex-1 bg-[var(--color-primary)] text-white py-3 rounded-2xl font-black text-xs uppercase tracking-[0.2em] min-h-[44px] disabled:opacity-60 hover:bg-[var(--color-primary-hover)]"
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
        reason={authReason}
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
              toast.type === "success" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-danger)] text-white"
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
