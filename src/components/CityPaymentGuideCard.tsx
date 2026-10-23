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
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm sm:p-6">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-warning)] text-white">
            <CreditCard size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--color-warning)]">{t("payment_guide_title")}</p>
            <h2 className="mt-1 text-base font-black text-[var(--color-text)]">{guide ? `${guide.city}, ${guide.country}` : city}</h2>
          </div>
          <ChevronDown
            size={18}
            className={`mt-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
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
                    <section key={mode} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
                      <h3 className="text-xs font-black uppercase tracking-wider text-[var(--color-text-muted)]">{t(`payment_mode_${mode}`)}</h3>
                      <div className="mt-3 space-y-3">
                        {facts.map((fact) => {
                          const date = checkedDate(fact.sources);
                          return (
                            <article key={fact.id}>
                              <p className="text-xs font-bold text-[var(--color-text)]">{fact.question}</p>
                              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{fact.answer}</p>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                {fact.sources.map((source) => (
                                  <a key={`${fact.id}-${source.url}`} href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--color-warning)] underline">
                                    {source.label}<ExternalLink size={10} />
                                  </a>
                                ))}
                                {date ? <span className="text-[10px] text-[var(--color-text-muted)]">{t("payment_checked_at", { date })}</span> : null}
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
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
                <p className="text-sm font-bold text-[var(--color-warning)]">{t("payment_guide_unverified", { city })}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{t("payment_guide_no_assumptions")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
