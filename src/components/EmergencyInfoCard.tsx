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
      <div className="rounded-3xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white p-5 shadow-sm dark:border-rose-900/60 dark:from-rose-950/30 dark:to-slate-950 sm:p-6">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-rose-600 text-white">
            <ShieldAlert size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-rose-700 dark:text-rose-300">
              {t("emergency_title")}
            </p>
            <h2 className="mt-1 text-base font-black text-slate-900 dark:text-white">
              {info.country}
              <span className="ml-2 text-sm font-bold text-rose-600 dark:text-rose-400">
                {info.emergencyNumber}
              </span>
            </h2>
          </div>
          <ChevronDown
            size={18}
            className={`mt-3 shrink-0 text-rose-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Collapsible body */}
        {open && (
          <div className="mt-4 space-y-4 pl-[52px]">
            {/* Emergency numbers */}
            <section className="rounded-2xl border border-rose-100/80 bg-white/70 p-4 dark:border-rose-900/40 dark:bg-slate-900/60">
              <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                <Phone size={13} />
                {t("emergency_numbers")}
              </h3>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{t("emergency_general")}</span>
                  <a
                    href={`tel:${info.emergencyNumber}`}
                    className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-black text-white hover:bg-rose-700"
                  >
                    {info.emergencyNumber}
                  </a>
                </div>
                {info.policeNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{t("emergency_police")}</span>
                    <a
                      href={`tel:${info.policeNumber}`}
                      className="rounded-lg bg-slate-600 px-3 py-1 text-xs font-black text-white hover:bg-slate-700"
                    >
                      {info.policeNumber}
                    </a>
                  </div>
                )}
                {info.ambulanceNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{t("emergency_ambulance")}</span>
                    <a
                      href={`tel:${info.ambulanceNumber}`}
                      className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-black text-white hover:bg-blue-700"
                    >
                      {info.ambulanceNumber}
                    </a>
                  </div>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {info.emergencyNotes}
                </p>
              </div>
            </section>

            {/* Medical phrases */}
            {info.phrases.length > 0 && (
              <section className="rounded-2xl border border-rose-100/80 bg-white/70 p-4 dark:border-rose-900/40 dark:bg-slate-900/60">
                <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                  <MessageCircle size={13} />
                  {t("emergency_phrases")} — {info.languages.join(", ")}
                </h3>
                <div className="mt-3 space-y-3">
                  {info.phrases.map((phrase) => (
                    <div key={phrase.intent} className="space-y-0.5">
                      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{phrase.intent}</p>
                      <p className="text-sm font-black text-slate-900 dark:text-white">{phrase.local}</p>
                      <p className="text-[10px] italic text-slate-400 dark:text-slate-500">{phrase.pronunciation}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Connectivity tips */}
            <section className="rounded-2xl border border-rose-100/80 bg-white/70 p-4 dark:border-rose-900/40 dark:bg-slate-900/60">
              <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                <Wifi size={13} />
                {t("emergency_connectivity")}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {info.connectivityTips}
              </p>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
