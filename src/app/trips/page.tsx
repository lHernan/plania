"use client";

import { useI18n } from "@/components/I18nProvider";

/**
 * /trips — waits for the trip selection: AuthInitializer moves to the selected trip
 * (/trips/:id) once it is loaded, or back to / when there is none.
 */
export default function TripsPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <div className="flex flex-col items-center gap-4">
        <div className="size-12 border-4 border-[var(--color-primary)]/20 border-t-[var(--color-primary)] rounded-full animate-spin" />
        <p className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest" suppressHydrationWarning>{t("landing_loading")}</p>
      </div>
    </div>
  );
}
