"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, Check, Loader2, MapPin, Plus, Share2, Star, Trash2, Users, X } from "lucide-react";
import { getCurrentDateString, resolveTripSelectionFromSummaries } from "@/lib/trip-selection";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { useI18n } from "@/components/I18nProvider";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

function isTripSummary(trip: ReturnType<typeof useItineraryStore.getState>["trips"][number] | undefined): trip is ReturnType<typeof useItineraryStore.getState>["trips"][number] {
  return Boolean(trip);
}

export function TripSwitcher() {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
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
    sharedTrips,
    activeTrip,
    fetchAllTrips,
    fetchSharedTrips,
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
      fetchSharedTrips();
    }
  }, [isOpen, fetchSharedTrips]);

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
              ? "bg-[var(--color-primary)] shadow-lg shadow-[var(--color-primary)]/20"
              : "bg-[var(--color-surface-subtle)] hover:bg-[var(--color-border)]"
          }`}
        >
          <div className={`size-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isCurrentTrip ? "bg-white/20 text-white" : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
          }`}>
            {isCurrentTrip ? <Check size={18} /> : <MapPin size={18} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className={`text-sm font-bold truncate ios-compact-title ${isCurrentTrip ? "text-white" : "text-[var(--color-text)]"}`}>
                {trip.name}
              </p>
              {timingBadge ? (
                <span className={`text-[10px] font-black ios-compact-meta ${isCurrentTrip ? "text-white/80" : "text-[var(--color-text-muted)]"}`}>
                  {timingBadge}
                </span>
              ) : null}
            </div>
            <p className={`text-[10px] font-medium mt-0.5 ios-compact-meta ${isCurrentTrip ? "text-white/70" : "text-[var(--color-text-muted)]"}`}>
              {t("switcher_trip_stats", { days: trip.dayCount, activities: trip.activityCount })}
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
                  ? "text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
            } ${favoriteBusyId === trip.id ? "opacity-70" : ""}`}
            aria-label={trip.isFavorite ? t("switcher_remove_favorite") : t("switcher_set_favorite")}
            title={trip.isFavorite ? t("switcher_remove_favorite") : t("switcher_set_favorite")}
          >
            <Star size={18} className={trip.isFavorite ? "fill-current" : ""} />
          </motion.button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={async (e) => {
              e.stopPropagation();
              if (await confirm({ message: t("switcher_delete_confirm") })) deleteTrip(trip.id);
            }}
            className={`flex size-11 items-center justify-center rounded-full transition-all ${
              isCurrentTrip
                ? "text-white/50 hover:text-white hover:bg-white/10"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            }`}
            aria-label={t("switcher_delete_trip")}
            title={t("switcher_delete_trip")}
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
            className="fixed inset-x-0 bottom-0 z-[210] bg-[var(--color-surface)] rounded-t-3xl flex flex-col ios-compact-shell"
            style={{ maxHeight: "85dvh" }}
          >
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] flex-shrink-0 ios-compact-row">
              <div>
                <span className="block text-sm font-black text-[var(--color-text)] tracking-tight ios-compact-title">{t("switcher_my_trips")}</span>
                {tripSelection.ui.hints.default_selection_label_key ? (
                  <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted)] mt-1 ios-compact-meta">
                    {t(tripSelection.ui.hints.default_selection_label_key)}
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setShowCreate(false);
                }}
                className="size-8 rounded-full bg-[var(--color-surface-subtle)] flex items-center justify-center text-[var(--color-text-muted)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-4 min-h-0">
              {trips.length === 0 && !loading ? (
                <div className="py-10 text-center">
                  <MapPin size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
                  <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                    {t(tripSelection.ui.hints.empty_state_key ?? "trip_selection_empty_state")}
                  </p>
                </div>
              ) : null}

              {tripSelection.ui.sections[0].visible ? (
                <section className="space-y-1.5">
                  <p className="px-1 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-muted)] ios-compact-meta">
                    {t(tripSelection.ui.sections[0].title_key)}
                  </p>
                  {groupedTrips.active.map((trip) => renderTripRow(trip, "active"))}
                </section>
              ) : null}

              {tripSelection.ui.sections[1].visible ? (
                <section className="space-y-1.5">
                  <p className="px-1 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-muted)] ios-compact-meta">
                    {t(tripSelection.ui.sections[1].title_key)}
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
                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-text-muted)] ios-compact-meta">
                      {t(tripSelection.ui.sections[2].title_key)}
                    </span>
                    <ChevronRight
                      size={14}
                      className={`text-[var(--color-text-muted)] transition-transform ${showPastTrips ? "rotate-90" : ""}`}
                    />
                  </button>
                  {showPastTrips ? groupedTrips.past.map((trip) => renderTripRow(trip, "past")) : null}
                </section>
              ) : null}
            </div>

              {/* SHARED TRIPS SECTION */}
              {sharedTrips.length > 0 && (
                <section className="space-y-1.5">
                  <div className="px-1 flex items-center gap-1.5">
                    <Share2 size={10} className="text-[var(--color-warning)]" />
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--color-warning)] ios-compact-meta">
                      {t("switcher_shared_with_me")}
                    </p>
                  </div>
                  {sharedTrips.map((trip) => {
                    const isCurrentTrip = activeTrip?.id === trip.id;
                    return (
                      <div key={trip.id} className="relative group">
                        <button
                          onClick={() => {
                            switchTrip(trip.id);
                            setIsOpen(false);
                            setShowCreate(false);
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all text-left ios-compact-row ios-compact-gap ${
                            isCurrentTrip
                              ? "bg-[var(--color-warning)] shadow-lg shadow-[var(--color-warning)]/20"
                              : "bg-[var(--color-surface-subtle)] hover:bg-[var(--color-warning)]/10"
                          }`}
                        >
                          <div className={`size-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            isCurrentTrip ? "bg-white/20 text-white" : "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                          }`}>
                            {isCurrentTrip ? <Check size={18} /> : <Share2 size={16} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className={`text-sm font-bold truncate ios-compact-title ${
                                isCurrentTrip ? "text-white" : "text-[var(--color-text)]"
                              }`}>
                                {trip.name}
                              </p>
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                                isCurrentTrip
                                  ? "bg-white/20 text-white"
                                  : "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                              }`}>
                                {t("switcher_shared_badge")}
                              </span>
                            </div>
                            <p className={`text-[10px] font-medium mt-0.5 ios-compact-meta ${
                              isCurrentTrip ? "text-white/70" : "text-[var(--color-text-muted)]"
                            }`}>
                              {t("switcher_shared_from", { email: trip.ownerEmail ?? "" })}
                            </p>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </section>
              )}

            <div className="flex-shrink-0 border-t border-[var(--color-border)] px-4 pt-3 pb-8">
              {showCreate ? (
                <form onSubmit={handleCreate} className="space-y-3">
                  <input
                    autoFocus
                    type="text"
                    placeholder={t("switcher_trip_name_placeholder")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-4 py-3 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-[var(--color-text-muted)] ml-1 mb-1 block">{t("switcher_start")}</label>
                      <input
                        type="date"
                        min={todayStr}
                        value={newStartDate}
                        onChange={(e) => setNewStartDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-widest text-[var(--color-text-muted)] ml-1 mb-1 block">{t("switcher_end")}</label>
                      <input
                        type="date"
                        min={newStartDate || todayStr}
                        value={newEndDate}
                        onChange={(e) => setNewEndDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={loading || !newName.trim()}
                      className="flex-1 bg-[var(--color-primary)] text-white py-3.5 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 size={14} className="animate-spin" /> : t("switcher_create_trip")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="px-5 py-3.5 rounded-xl bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] text-xs font-bold"
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-dashed border-[var(--color-primary)]/30 text-[var(--color-primary)] font-bold text-xs uppercase tracking-widest hover:bg-[var(--color-primary-subtle)] transition-all"
                >
                  <Plus size={16} />
                  {t("switcher_new_trip")}
                </button>
              )}
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );

  return (
    <div className="relative min-w-0">
      {dialog}
      <button
        onClick={() => setIsOpen(true)}
        className="flex min-w-0 items-center gap-1.5 max-w-[min(180px,100%)] md:max-w-[220px]"
      >
        <div className="flex flex-col items-start min-w-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--color-text-muted)] leading-none mb-0.5 ios-compact-meta">{t("trip_selection_current_trip")}</span>
          <span className="text-sm font-black text-[var(--color-text)] truncate max-w-full md:max-w-[180px] leading-tight ios-compact-title">
            {activeTrip?.name ?? t("switcher_select_trip")}
          </span>
        </div>
        <ChevronDown size={14} className={`text-[var(--color-text-muted)] transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {typeof document !== "undefined" ? createPortal(sheet, document.body) : null}
    </div>
  );
}
