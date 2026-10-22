/**
 * City/country → currency resolution and exchange-rate types.
 *
 * The mapping is intentionally small: it covers the cities Plania already
 * knows (payment guides) plus common travel destinations.  Unknown cities
 * return `undefined` and the widget simply hides.
 */

// ISO 4217 currency code
export type CurrencyCode = string;

export type ExchangeRate = {
  base: CurrencyCode;
  target: CurrencyCode;
  rate: number;
  /** ISO-8601 date string from the provider (e.g. "2026-10-22") */
  date: string;
};

// ── Country-code → currency ────────────────────────────────────────────────

const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  // Europe
  ES: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", NL: "EUR", PT: "EUR",
  BE: "EUR", AT: "EUR", GR: "EUR", IE: "EUR", FI: "EUR",
  GB: "GBP", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK",
  CZ: "CZK", PL: "PLN", HU: "HUF", RO: "RON", HR: "EUR",
  TR: "TRY", IS: "ISK",
  // Asia
  JP: "JPY", KR: "KRW", CN: "CNY", TH: "THB", VN: "VND",
  ID: "IDR", MY: "MYR", SG: "SGD", PH: "PHP", IN: "INR",
  TW: "TWD", HK: "HKD", AE: "AED", IL: "ILS",
  // Americas
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS",
  CL: "CLP", CO: "COP", PE: "PEN", UY: "UYU",
  // Oceania
  AU: "AUD", NZ: "NZD",
  // Africa
  ZA: "ZAR", MA: "MAD", EG: "EGP", KE: "KES",
};

// ── City-name → currency (covers common destinations) ──────────────────────

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const CITY_CURRENCY: Record<string, CurrencyCode> = {
  // Spain
  madrid: "EUR", barcelona: "EUR", seville: "EUR", sevilla: "EUR",
  valencia: "EUR", malaga: "EUR", bilbao: "EUR", "san sebastian": "EUR",
  granada: "EUR", tenerife: "EUR", "las palmas": "EUR", ibiza: "EUR",
  // France
  paris: "EUR", lyon: "EUR", nice: "EUR", marseille: "EUR",
  bordeaux: "EUR", strasbourg: "EUR",
  // Italy
  rome: "EUR", roma: "EUR", milan: "EUR", milano: "EUR",
  florence: "EUR", firenze: "EUR", venice: "EUR", venezia: "EUR",
  naples: "EUR", napoli: "EUR", amalfi: "EUR",
  // Germany
  berlin: "EUR", munich: "EUR", munchen: "EUR", hamburg: "EUR",
  frankfurt: "EUR", cologne: "EUR", koln: "EUR",
  // UK
  london: "GBP", edinburgh: "GBP", manchester: "GBP",
  // Switzerland
  zurich: "CHF", geneva: "CHF", geneve: "CHF", bern: "CHF",
  // Nordics
  stockholm: "SEK", oslo: "NOK", copenhagen: "DKK", kobenhavn: "DKK",
  helsinki: "EUR", reykjavik: "ISK",
  // Eastern Europe
  prague: "CZK", praha: "CZK", budapest: "HUF", warsaw: "PLN",
  warszawa: "PLN", bucharest: "RON", bucuresti: "RON",
  zagreb: "EUR", dubrovnik: "EUR", split: "EUR",
  istanbul: "TRY", athens: "EUR", atenas: "EUR",
  lisbon: "EUR", lisboa: "EUR", porto: "EUR",
  amsterdam: "EUR", bruges: "EUR", brussels: "EUR", bruxelles: "EUR",
  vienna: "EUR", wien: "EUR", dublin: "EUR",
  // Asia
  tokyo: "JPY", osaka: "JPY", kyoto: "JPY",
  seoul: "KRW", busan: "KRW",
  beijing: "CNY", shanghai: "CNY", "hong kong": "HKD",
  bangkok: "THB", "chiang mai": "THB", phuket: "THB",
  hanoi: "VND", "ho chi minh": "VND", saigon: "VND",
  singapore: "SGD", "kuala lumpur": "MYR", bali: "IDR", jakarta: "IDR",
  manila: "PHP", taipei: "TWD", dubai: "AED", "abu dhabi": "AED",
  "tel aviv": "ILS", jerusalem: "ILS",
  mumbai: "INR", delhi: "INR", "new delhi": "INR", goa: "INR",
  // Americas
  "new york": "USD", "los angeles": "USD", miami: "USD",
  "san francisco": "USD", chicago: "USD", "las vegas": "USD",
  toronto: "CAD", vancouver: "CAD", montreal: "CAD",
  "mexico city": "MXN", "ciudad de mexico": "MXN", cancun: "MXN",
  playa: "MXN", tulum: "MXN",
  "sao paulo": "BRL", rio: "BRL", "rio de janeiro": "BRL",
  "buenos aires": "ARS", santiago: "CLP", lima: "PEN",
  bogota: "COP", medellin: "COP", cartagena: "COP",
  montevideo: "UYU",
  // Oceania
  sydney: "AUD", melbourne: "AUD", auckland: "NZD",
  // Africa
  "cape town": "ZAR", marrakech: "MAD", cairo: "EGP", nairobi: "KES",
};

/**
 * Resolve a currency code from a city name or country code.
 * Tries the full city string first, then the segment before a comma or dash,
 * then individual words — so "Madrid, Spain", "Madrid Spain", and "Madrid"
 * all resolve to EUR.
 */
export function resolveCurrency(
  city: string | undefined,
  countryCode?: string,
): CurrencyCode | undefined {
  if (city) {
    const norm = normalize(city);
    // Exact match
    const exact = CITY_CURRENCY[norm];
    if (exact) return exact;
    // Before comma/dash ("Madrid, Spain" → "madrid")
    const beforeSep = norm.split(/[,\-–—]/)[0].trim();
    if (beforeSep && beforeSep !== norm) {
      const hit = CITY_CURRENCY[beforeSep];
      if (hit) return hit;
    }
    // First word ("Madrid Spain" → "madrid") — only for multi-word input
    const words = norm.split(/\s+/);
    if (words.length > 1) {
      const first = CITY_CURRENCY[words[0]];
      if (first) return first;
      // Also try last word in case order is reversed ("Spain Madrid")
      const last = CITY_CURRENCY[words[words.length - 1]];
      if (last) return last;
    }
  }
  if (countryCode) {
    return COUNTRY_CURRENCY[countryCode.toUpperCase()];
  }
  return undefined;
}

/** Commonly used home currencies for the selector. */
export const HOME_CURRENCIES: CurrencyCode[] = [
  "USD", "EUR", "GBP", "JPY", "KRW", "CAD", "AUD",
  "CHF", "MXN", "BRL", "ARS", "CLP", "COP",
];

/** Friendly labels — only for the selector UI. */
export const CURRENCY_LABELS: Record<string, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  KRW: "Korean Won",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  CHF: "Swiss Franc",
  MXN: "Mexican Peso",
  BRL: "Brazilian Real",
  ARS: "Argentine Peso",
  CLP: "Chilean Peso",
  COP: "Colombian Peso",
};

/**
 * Format an amount in the given currency using the browser locale.
 * Falls back to a plain number if the currency code is unrecognized.
 */
export function formatCurrency(
  amount: number,
  currency: CurrencyCode,
  locale?: string,
): string {
  try {
    return new Intl.NumberFormat(locale ?? "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amount >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
