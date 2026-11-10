/** Number of decimals of a currency's minor unit (EUR 2, JPY 0); 2 for an unknown code. */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Integer part with optional thousands separators: "1234" or "1.234.567". */
function parseInteger(text: string, thousands: string | null): string | null {
  if (!thousands) return /^\d+$/.test(text) ? text : null;
  const groups = text.split(thousands);
  if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((group) => !/^\d{3}$/.test(group))) return null;
  return groups.join("");
}

/**
 * Typed amount to minor units: accepts "12", "12,5", "12.50", "1.234,56", "1,234.56" and ignores
 * spaces and currency symbols. A single separator is the decimal one unless the currency has no
 * decimals (then "1.500" is 1500). Null when empty, invalid, negative or with too many decimals.
 */
export function parseAmountToCents(text: string, currency: string): number | null {
  const cleaned = text.replace(/[\s\p{Sc}]/gu, "");
  if (!/^[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;
  const decimals = currencyDecimals(currency);
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let decimalSep: string | null = null;
  let thousandsSep: string | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? "," : ".";
    thousandsSep = decimalSep === "," ? "." : ",";
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const repeated = cleaned.indexOf(sep) !== cleaned.lastIndexOf(sep);
    if (repeated || decimals === 0) thousandsSep = sep;
    else decimalSep = sep;
  }
  const [integerText, fractionText = ""] = decimalSep ? cleaned.split(decimalSep) : [cleaned];
  if (decimalSep && (cleaned.split(decimalSep).length > 2 || fractionText.length === 0)) return null;
  if (fractionText.length > decimals || !/^\d*$/.test(fractionText)) return null;
  const integerDigits = parseInteger(integerText, thousandsSep);
  if (integerDigits === null) return null;
  const cents = Number(integerDigits + fractionText.padEnd(decimals, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Minor units as a localized currency string; `signed` adds "+" to positive amounts (balances). */
export function formatCents(cents: number, currency: string, locale: string, options: { signed?: boolean } = {}): string {
  const decimals = currencyDecimals(currency);
  const value = cents / 10 ** decimals;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, signDisplay: options.signed ? "exceptZero" : "auto" }).format(value);
  } catch {
    const sign = options.signed && cents > 0 ? "+" : "";
    return `${sign}${value.toFixed(decimals)} ${currency}`;
  }
}
