"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, Luggage, Map as MapIcon, Receipt, Wallet, type LucideIcon } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { OVER_COVER_SURFACE } from "@/components/TripCover";
import { parseTripPath, tripPath, TRIP_SECTIONS, type TripSection } from "@/lib/trip-routes";

const SECTION_ICONS: Record<TripSection, LucideIcon> = {
  itinerary: CalendarDays,
  expenses: Receipt,
  map: MapIcon,
  wallet: Wallet,
  overview: Luggage,
};

/** Tour steps that explain what lives in these sections, shown on their links. */
const TOUR_ANCHORS: Partial<Record<TripSection, string>> = {
  wallet: "section-wallet",
  overview: "section-overview",
};

/** A section of the trip with the selected day (`?day=`), so the day carries over. */
export function tripSectionHref(tripId: string, section: TripSection, day?: string | null): string {
  const path = tripPath(tripId, section);
  return day ? `${path}?day=${encodeURIComponent(day)}` : path;
}

/**
 * The sections of a trip. `bar` is the fixed bottom bar on mobile; `tabs` is the row
 * inside the header on desktop. Both are links, so each section has its own address.
 * Over a trip cover (`overCover`) the tabs become separate frosted pills so they read on any photo.
 */
export function TripSectionNav({ tripId, variant, overCover = false }: { tripId: string; variant: "bar" | "tabs"; overCover?: boolean }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = parseTripPath(pathname ?? "")?.section ?? "itinerary";
  const day = searchParams?.get("day") ?? null;
  const isBar = variant === "bar";
  const labels: Record<TripSection, string> = {
    itinerary: t("section_itinerary"),
    expenses: t("section_expenses"),
    map: t("section_map"),
    wallet: t("section_wallet"),
    overview: t("section_overview"),
  };

  return (
    <nav
      data-tour="sections"
      aria-label={t("section_nav_label")}
      className={
        isBar
          ? "fixed inset-x-0 bottom-0 z-40 md:hidden border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom,0px)]"
          : "hidden md:flex items-center gap-1 px-4 max-w-7xl mx-auto"
      }
    >
      <ul className={isBar ? "grid grid-cols-5" : overCover ? "flex items-center gap-2 py-1.5" : "flex items-center gap-1"}>
        {TRIP_SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section];
          const active = section === current;
          return (
            <li key={section}>
              <Link
                href={tripSectionHref(tripId, section, day)}
                aria-current={active ? "page" : undefined}
                data-tour={TOUR_ANCHORS[section]}
                className={
                  isBar
                    ? `flex h-16 min-h-11 min-w-11 flex-col items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]/40 ${
                        active ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                      }`
                    : overCover
                      ? `inline-flex min-h-11 min-w-11 items-center gap-2 rounded-full border px-4 text-xs font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 ${OVER_COVER_SURFACE} ${
                          active
                            ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                            : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                        }`
                      : `inline-flex min-h-11 min-w-11 items-center gap-2 border-b-2 px-4 text-xs font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40 ${
                        active
                          ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                          : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                      }`
                }
              >
                <Icon size={isBar ? 20 : 16} aria-hidden="true" />
                <span>{labels[section]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
