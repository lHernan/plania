"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Share2, Star, Trash2, WifiOff } from "lucide-react";
import { AccountMenu, applyTheme, readTheme } from "@/components/AccountMenu";
import { AuthModal } from "@/components/AuthModal";
import { useI18n } from "@/components/I18nProvider";
import { TripCoverImage } from "@/components/TripCover";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { tripPath } from "@/lib/trip-routes";
import { getCurrentDateString, resolveTripSelectionFromSummaries } from "@/lib/trip-selection";
import { TRIP_TEMPLATES, type TripTemplate } from "@/lib/trip-templates";
import type { SharedTripSummary, TripSummary } from "@/lib/types";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

type GroupKey = "active" | "upcoming" | "planning" | "shared" | "past";

const GROUP_TITLE_KEYS = {
  active: "my_trips_group_active",
  upcoming: "my_trips_group_upcoming",
  planning: "my_trips_group_planning",
  shared: "my_trips_group_shared",
  past: "my_trips_group_past",
} as const;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** "1–4 mar 2998" style range in the interface language. */
function formatDateRange(start: string, end: string, lang: string): string {
  const toUtc = (value: string) => new Date(`${value}T00:00:00Z`);
  const format = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return start === end ? format.format(toUtc(start)) : format.formatRange(toUtc(start), toUtc(end));
}

function isShared(trip: TripSummary | SharedTripSummary): trip is SharedTripSummary {
  return "ownerEmail" in trip;
}

/**
 * Mis viajes (/trips): every trip grouped by when it happens, with open, favorite, delete
 * and create. The grouping by dates is the trip selection's; trips without dates are
 * "planning" and trips shared with the user have their own group.
 */
export function MyTrips() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();

  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const signOut = useAuthStore((s) => s.signOut);
  const {
    trips,
    sharedTrips,
    activeTrip,
    hasFetched,
    loading,
    fetchSharedTrips,
    deleteTrip,
    setTripFavorite,
    loadTemplate,
  } = useItineraryStore();

  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const todayStr = getCurrentDateString();
  const userId = user?.id;

  useEffect(() => {
    applyTheme(readTheme());
  }, []);

  // Own trips come with the session (AuthInitializer); shared ones are asked for here.
  useEffect(() => {
    if (userId) void fetchSharedTrips();
  }, [fetchSharedTrips, userId]);

  const groups = useMemo(() => {
    // The trips query returns every trip the user may read, shared ones included: only the
    // user's own trips go in the dated groups (with favorite and delete), shared ones only
    // under shared, and trips that are neither are left out.
    const sharedIds = new Set(sharedTrips.map((trip) => trip.id));
    const ownTrips = trips.filter((trip) => (trip.userId ? trip.userId === userId : !sharedIds.has(trip.id)));
    const selection = resolveTripSelectionFromSummaries(todayStr, ownTrips);
    const byId = new Map(ownTrips.map((trip) => [trip.id, trip]));
    const pick = (list: { id: string }[]) => list.map(({ id }) => byId.get(id)).filter((trip): trip is TripSummary => Boolean(trip));
    const result: [GroupKey, (TripSummary | SharedTripSummary)[]][] = [
      ["active", pick(selection.groups.active)],
      ["upcoming", pick(selection.groups.upcoming)],
      ["planning", ownTrips.filter((trip) => !trip.startDate || !trip.endDate)],
      ["shared", sharedTrips],
      ["past", pick(selection.groups.past)],
    ];
    return result.filter(([, list]) => list.length > 0);
  }, [sharedTrips, todayStr, trips, userId]);

  const hasAnyTrip = groups.length > 0;
  const isLoading = !hasAnyTrip && (!initialized || !hasFetched || loading);
  const signedInEmail = user && !user.is_anonymous ? user.email ?? "" : null;

  const handleTemplate = (template: TripTemplate) => {
    loadTemplate(template.plan);
    router.push(tripPath(template.plan.id));
  };

  const renderCard = (trip: TripSummary | SharedTripSummary) => {
    const shared = isShared(trip);
    const dated = Boolean(trip.startDate && trip.endDate);
    return (
      <article
        key={trip.id}
        aria-label={trip.name}
        className="relative flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-[var(--color-primary)]/40"
      >
        <div
          aria-hidden="true"
          className={`relative flex h-20 items-center justify-center overflow-hidden bg-gradient-to-br text-3xl font-black text-white/90 ${
            shared
              ? "from-[var(--color-warning)] to-[var(--color-warning)]/60"
              : "from-[var(--color-primary)] to-[var(--color-primary)]/60"
          }`}
        >
          {trip.name.trim().charAt(0).toUpperCase()}
          {/* The uploaded cover over the default look; without one the card looks as before. */}
          <TripCoverImage path={trip.coverPath} />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4 pr-24">
          <h3 className="truncate text-sm font-black text-[var(--color-text)]">{trip.name}</h3>
          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
            {dated ? formatDateRange(trip.startDate as string, trip.endDate as string, lang) : t("my_trips_no_dates")}
          </p>
          <p className="text-[11px] font-medium text-[var(--color-text-muted)]">
            {t("switcher_trip_stats", { days: trip.dayCount, activities: trip.activityCount })}
          </p>
          {shared && (
            <p className="flex items-center gap-1 text-[11px] font-semibold text-[var(--color-warning)]">
              <Share2 size={11} aria-hidden="true" />
              {t("switcher_shared_from", { email: trip.ownerEmail ?? "" })}
            </p>
          )}
        </div>
        {/* The whole card opens the trip; the buttons sit above this link. */}
        <Link
          href={tripPath(trip.id)}
          aria-label={t("my_trips_open", { name: trip.name })}
          className="absolute inset-0 rounded-2xl focus-visible:outline-none"
        />
        {!shared && (
          <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                setFavoriteBusyId(trip.id);
                await setTripFavorite(trip.id);
                setFavoriteBusyId((current) => (current === trip.id ? null : current));
              }}
              disabled={favoriteBusyId === trip.id}
              aria-label={trip.isFavorite ? t("switcher_remove_favorite") : t("switcher_set_favorite")}
              title={trip.isFavorite ? t("switcher_remove_favorite") : t("switcher_set_favorite")}
              className={`flex size-11 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-warning)]/10 ${
                trip.isFavorite ? "text-[var(--color-warning)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-warning)]"
              } ${favoriteBusyId === trip.id ? "opacity-70" : ""}`}
            >
              <Star size={18} className={trip.isFavorite ? "fill-current" : ""} />
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await confirm({ message: t("switcher_delete_confirm") })) void deleteTrip(trip.id);
              }}
              aria-label={t("switcher_delete_trip")}
              title={t("switcher_delete_trip")}
              className="flex size-11 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </article>
    );
  };

  const gridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      {dialog}
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <h1 className="flex-1 truncate text-lg font-black tracking-tight text-[var(--color-text)] font-[family-name:var(--font-display)]">
            {t("my_trips_title")}
          </h1>
          <Link
            href="/plan"
            className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-3 text-xs font-black text-white hover:bg-[var(--color-primary-hover)]"
          >
            <Plus size={14} aria-hidden="true" />
            {t("switcher_new_trip")}
          </Link>
          <AccountMenu email={signedInEmail} onSignOut={() => void signOut()} onSignIn={() => setShowAuthModal(true)} />
        </div>
        {activeTrip && (
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <Link href={tripPath(activeTrip.id)} className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-[var(--color-primary)]">
              <ArrowLeft size={14} aria-hidden="true" />
              {t("my_trips_back_to_trip")}
            </Link>
          </div>
        )}
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6">
        {!online && hasAnyTrip && (
          <p className="flex items-center gap-2 rounded-xl bg-[var(--color-surface-subtle)] px-4 py-3 text-xs font-semibold text-[var(--color-text-secondary)]">
            <WifiOff size={14} aria-hidden="true" />
            {t("my_trips_offline")}
          </p>
        )}

        {isLoading ? (
          <div role="status" aria-label={t("my_trips_loading")} className={gridClass}>
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-44 animate-pulse rounded-2xl bg-[var(--color-surface-subtle)]" />
            ))}
          </div>
        ) : hasAnyTrip ? (
          groups.map(([key, list]) => (
            <section key={key} aria-labelledby={`my-trips-${key}`} className="space-y-3">
              <h2 id={`my-trips-${key}`} className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                {t(GROUP_TITLE_KEYS[key])}
              </h2>
              <div className={gridClass}>{list.map(renderCard)}</div>
            </section>
          ))
        ) : (
          <div className="space-y-8">
            <div className="space-y-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
              <h2 className="text-xl font-black text-[var(--color-text)] font-[family-name:var(--font-display)]">{t("my_trips_empty_title")}</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">{t("my_trips_empty_body")}</p>
              <Link
                href="/plan"
                className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[var(--color-primary)] px-6 text-xs font-black uppercase tracking-[0.2em] text-white hover:bg-[var(--color-primary-hover)]"
              >
                <Plus size={16} aria-hidden="true" />
                {t("my_trips_create_first")}
              </Link>
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-[var(--color-primary)]">{t("landing_examples_title")}</h3>
              <div className={gridClass}>
                {TRIP_TEMPLATES.map((template) => (
                  <div key={template.id} className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--color-primary-subtle)] text-2xl" aria-hidden="true">
                        {template.coverEmoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-[var(--color-text)]">{template.name}</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                          {t("my_trips_template_days", { days: template.durationDays })}
                        </p>
                      </div>
                    </div>
                    <p className="flex-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{template.description}</p>
                    <button
                      type="button"
                      onClick={() => handleTemplate(template)}
                      className="min-h-11 rounded-2xl bg-[var(--color-primary)] text-xs font-black uppercase tracking-[0.2em] text-white hover:bg-[var(--color-primary-hover)]"
                    >
                      {t("landing_use_template")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onShowToast={() => {}} />
    </main>
  );
}
