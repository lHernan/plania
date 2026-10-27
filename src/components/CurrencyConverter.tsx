"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, ChevronDown, RefreshCw } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import {
  resolveCurrency,
  formatCurrency,
  HOME_CURRENCIES,
  CURRENCY_LABELS,
  type CurrencyCode,
  type ExchangeRate,
} from "@/lib/currency";
import { findCityPaymentGuide } from "@/lib/city-payment-guides";

const STORAGE_KEY = "plania_home_currency";

function getStoredHome(): CurrencyCode {
  if (typeof window === "undefined") return "USD";
  return localStorage.getItem(STORAGE_KEY) ?? "USD";
}

/** Resolve currency with payment-guide countryCode as fallback. */
function resolveWithFallback(city: string): CurrencyCode | undefined {
  const direct = resolveCurrency(city);
  if (direct) return direct;
  // Fallback: use payment guide's countryCode
  const guide = findCityPaymentGuide(city);
  if (guide) return resolveCurrency(undefined, guide.countryCode);
  return undefined;
}

export function CurrencyConverter({ city }: { city: string }) {
  const { t } = useI18n();
  const [homeCurrency, setHomeCurrency] = useState<CurrencyCode>(getStoredHome);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [amount, setAmount] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const destinationCurrency = useMemo(() => resolveWithFallback(city), [city]);

  const sameCurrency = destinationCurrency === homeCurrency;

  const fetchRate = useCallback(
    async (base: CurrencyCode, target: CurrencyCode) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(false);

      try {
        const res = await fetch(
          `/api/currency?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error("fetch failed");
        const data = (await res.json()) as ExchangeRate;
        setRate(data);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!destinationCurrency || sameCurrency) return;
    void fetchRate(homeCurrency, destinationCurrency);
    return () => abortRef.current?.abort();
  }, [homeCurrency, destinationCurrency, sameCurrency, fetchRate]);

  function changeHome(code: CurrencyCode) {
    setHomeCurrency(code);
    localStorage.setItem(STORAGE_KEY, code);
    setSelectorOpen(false);
    setRate(null);
  }

  // Only hide when city currency is truly unknown
  if (!destinationCurrency) return null;

  const parsed = parseFloat(amount);
  const converted =
    rate && Number.isFinite(parsed) && parsed > 0
      ? parsed * rate.rate
      : null;

  return (
    <section className="mx-auto mt-5 w-full max-w-7xl px-5">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm sm:p-6">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-start gap-3 text-left"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white">
            <ArrowRightLeft size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--color-primary)]">
              {t("currency_title")}
            </p>
            {sameCurrency ? (
              <h2 className="mt-1 text-base font-black text-[var(--color-text)]">
                {destinationCurrency}
                <span className="ml-2 text-sm font-bold text-[var(--color-primary)] opacity-60">
                  {t("currency_same")}
                </span>
              </h2>
            ) : (
              <h2 className="mt-1 text-base font-black text-[var(--color-text)]">
                {homeCurrency} → {destinationCurrency}
                {rate && !open ? (
                  <span className="ml-2 text-sm font-bold text-[var(--color-primary)]">
                    {formatCurrency(1, homeCurrency)} = {formatCurrency(rate.rate, destinationCurrency)}
                  </span>
                ) : null}
              </h2>
            )}
          </div>
          <ChevronDown
            size={18}
            className={`mt-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Collapsible body */}
        {open && (
          <div className="mt-4 pl-[52px]">
            {sameCurrency ? (
              /* Same currency — only show the home selector so users can change it */
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {t("currency_same_hint", { currency: destinationCurrency })}
                </p>
              </div>
            ) : (
              /* Different currencies — rate display + converter */
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
                {loading ? (
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <RefreshCw size={12} className="animate-spin" />
                    {t("currency_loading")}
                  </div>
                ) : error ? (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-danger)]">{t("currency_error")}</p>
                    <button
                      type="button"
                      onClick={() => void fetchRate(homeCurrency, destinationCurrency)}
                      className="text-[10px] font-bold text-[var(--color-primary)] hover:underline"
                    >
                      {t("currency_retry")}
                    </button>
                  </div>
                ) : rate ? (
                  <div className="space-y-3">
                    {/* Exchange rate */}
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-black text-[var(--color-text)]">
                        {formatCurrency(1, homeCurrency)} = {formatCurrency(rate.rate, destinationCurrency)}
                      </span>
                    </div>

                    {/* Quick converter */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">
                          {homeCurrency}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="100"
                          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-12 pr-3 text-sm font-bold text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                        />
                      </div>
                      <ArrowRightLeft size={14} className="shrink-0 text-[var(--color-text-muted)]" />
                      <div className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-primary-subtle)] py-2 px-3">
                        <p className="text-sm font-black text-[var(--color-primary)]">
                          {converted != null
                            ? formatCurrency(converted, destinationCurrency)
                            : `— ${destinationCurrency}`}
                        </p>
                      </div>
                    </div>

                    {/* Source + date */}
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {t("currency_source", { date: rate.date })}
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {/* Home currency selector — always available */}
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] font-bold text-[var(--color-text-secondary)]">
                {t("currency_home")}:
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSelectorOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-bold text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
                >
                  {homeCurrency} — {CURRENCY_LABELS[homeCurrency] ?? homeCurrency}
                  <ChevronDown size={12} />
                </button>
                {selectorOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-56 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
                    {HOME_CURRENCIES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => changeHome(code)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-[var(--color-surface-subtle)] ${
                          code === homeCurrency
                            ? "text-[var(--color-primary)]"
                            : "text-[var(--color-text)]"
                        }`}
                      >
                        <span className="font-black">{code}</span>
                        <span className="text-[var(--color-text-secondary)]">{CURRENCY_LABELS[code] ?? code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
