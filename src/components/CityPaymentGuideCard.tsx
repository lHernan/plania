"use client";

import { useState } from "react";
import { ChevronDown, CreditCard, ExternalLink } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { findCityPaymentGuide, type PaymentGuideMode } from "@/lib/city-payment-guides";

const MODES: PaymentGuideMode[] = ["public_transport", "taxi", "ride_hailing"];

function checkedDate(sources: Array<{ checkedAt: string }>) {
  const latest = sources.map((source) => new Date(source.checkedAt)).filter((date) => Number.isFinite(date.getTime())).sort((left, right) => right.getTime() - left.getTime())[0];
  return latest ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(latest) : null;
}

export function CityPaymentGuideCard({ city }: { city: string }) {
  const { t } = useI18n();
  const guide = findCityPaymentGuide(city);
  const [open, setOpen] = useState(false);

  const normalizedCity = (city ?? "").trim();
  if (!normalizedCity || normalizedCity.toLowerCase() === "new destination") {
    return null;
  }

  return (
    <section className="mx-auto mt-5 w-full max-w-7xl px-5">
      <div className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm dark:border-violet-900/60 dark:from-violet-950/30 dark:to-slate-950 sm:p-6">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white">
            <CreditCard size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">{t("payment_guide_title")}</p>
            <h2 className="mt-1 text-base font-black text-slate-900 dark:text-white">{guide ? `${guide.city}, ${guide.country}` : city}</h2>
          </div>
          <ChevronDown
            size={18}
            className={`mt-3 shrink-0 text-violet-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="mt-4 pl-[52px]">
            {guide ? (
              <div className="space-y-4">
                {MODES.map((mode) => {
                  const facts = guide.facts.filter((fact) => fact.mode === mode);
                  if (facts.length === 0) return null;
                  return (
                    <section key={mode} className="rounded-2xl border border-violet-100/80 bg-white/70 p-4 dark:border-violet-900/40 dark:bg-slate-900/60">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">{t(`payment_mode_${mode}`)}</h3>
                      <div className="mt-3 space-y-3">
                        {facts.map((fact) => {
                          const date = checkedDate(fact.sources);
                          return (
                            <article key={fact.id}>
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{fact.question}</p>
                              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{fact.answer}</p>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                {fact.sources.map((source) => (
                                  <a key={`${fact.id}-${source.url}`} href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 underline dark:text-violet-300">
                                    {source.label}<ExternalLink size={10} />
                                  </a>
                                ))}
                                {date ? <span className="text-[10px] text-slate-400">{t("payment_checked_at", { date })}</span> : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">{t("payment_guide_unverified", { city })}</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800/80 dark:text-amber-300/80">{t("payment_guide_no_assumptions")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
