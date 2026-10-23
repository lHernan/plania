"use client";

import { useState } from "react";
import { ChevronDown, Phone, ShieldAlert, MessageCircle, Wifi } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { findEmergencyInfo } from "@/lib/emergency-info";

export function EmergencyInfoCard({ city }: { city: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const info = findEmergencyInfo(city);

  if (!info) return null;

  return (
    <section className="mx-auto mt-5 w-full max-w-7xl px-5">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm sm:p-6">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-danger)] text-white">
            <ShieldAlert size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--color-danger)]">
              {t("emergency_title")}
            </p>
            <h2 className="mt-1 text-base font-black text-[var(--color-text)]">
              {info.country}
              <span className="ml-2 text-sm font-bold text-[var(--color-danger)]">
                {info.emergencyNumber}
              </span>
            </h2>
          </div>
          <ChevronDown
            size={18}
            className={`mt-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Collapsible body */}
        {open && (
          <div className="mt-4 space-y-4 pl-[52px]">
            {/* Emergency numbers */}
            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
              <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--color-text-muted)]">
                <Phone size={13} />
                {t("emergency_numbers")}
              </h3>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--color-text-secondary)]">{t("emergency_general")}</span>
                  <a
                    href={`tel:${info.emergencyNumber}`}
                    className="rounded-lg bg-[var(--color-danger)] px-3 py-1 text-xs font-black text-white hover:opacity-90"
                  >
                    {info.emergencyNumber}
                  </a>
                </div>
                {info.policeNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--color-text-secondary)]">{t("emergency_police")}</span>
                    <a
                      href={`tel:${info.policeNumber}`}
                      className="rounded-lg bg-[var(--color-text-secondary)] px-3 py-1 text-xs font-black text-white hover:opacity-90"
                    >
                      {info.policeNumber}
                    </a>
                  </div>
                )}
                {info.ambulanceNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--color-text-secondary)]">{t("emergency_ambulance")}</span>
                    <a
                      href={`tel:${info.ambulanceNumber}`}
                      className="rounded-lg bg-[var(--color-transport)] px-3 py-1 text-xs font-black text-white hover:opacity-90"
                    >
                      {info.ambulanceNumber}
                    </a>
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  {info.emergencyNotes}
                </p>
              </div>
            </section>

            {/* Medical phrases */}
            {info.phrases.length > 0 && (
              <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--color-text-muted)]">
                  <MessageCircle size={13} />
                  {t("emergency_phrases")} — {info.languages.join(", ")}
                </h3>
                <div className="mt-3 space-y-3">
                  {info.phrases.map((phrase) => (
                    <div key={phrase.intent} className="space-y-0.5">
                      <p className="text-[11px] font-bold text-[var(--color-text-secondary)]">{phrase.intent}</p>
                      <p className="text-sm font-black text-[var(--color-text)]">{phrase.local}</p>
                      <p className="text-[10px] italic text-[var(--color-text-muted)]">{phrase.pronunciation}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Connectivity tips */}
            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
              <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--color-text-muted)]">
                <Wifi size={13} />
                {t("emergency_connectivity")}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {info.connectivityTips}
              </p>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
