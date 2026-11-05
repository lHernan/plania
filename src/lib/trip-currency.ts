
import { useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { formatCurrency, HOME_CURRENCIES, type CurrencyCode } from "@/lib/currency";
import { supabase } from "@/lib/supabase";
import { normalizeCurrency } from "@/lib/travel-context";
import type { TravelContext } from "@/lib/types";
import { useAuthStore } from "@/store/use-auth-store";

/**
 * The preferred currency (profile) and the trip currency.
 *
 * A registered user keeps the preference in Supabase auth `user_metadata.preferred_currency`;
 * a guest, or a user who never chose, falls back to this device's home currency
 * (`plania_home_currency`, shared with the currency converter) and then to USD.
 * A trip stores its own currency in `travel_context.currency`; trips saved before it existed
 * use the preference at read time.
 */

export const HOME_CURRENCY_STORAGE_KEY = "plania_home_currency";
export const DEFAULT_CURRENCY: CurrencyCode = "USD";
const PREFERENCE_EVENT = "plania:preferred-currency";

type PreferenceUser = Pick<User, "user_metadata"> & { is_anonymous?: boolean };

export function readStoredCurrency(): CurrencyCode | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return normalizeCurrency(window.localStorage.getItem(HOME_CURRENCY_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function resolvePreferredCurrency(
  user: PreferenceUser | null | undefined,
  stored: CurrencyCode | undefined = readStoredCurrency(),
): CurrencyCode {
  return normalizeCurrency(user?.user_metadata?.preferred_currency) ?? stored ?? DEFAULT_CURRENCY;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREFERENCE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREFERENCE_EVENT, onChange);
  };
}

/** The signed-in user's preferred currency, read after hydration. */
export function usePreferredCurrency(): CurrencyCode {
  const user = useAuthStore((s) => s.user);
  const stored = useSyncExternalStore(subscribe, readStoredCurrency, () => undefined);
  return resolvePreferredCurrency(user, stored);
}

/**
 * Saves the preference on this device and, for a registered user, in the profile.
 * Resolves with the updated user when the profile changed.
 */
export async function savePreferredCurrency(
  code: CurrencyCode,
  user: (PreferenceUser & { id: string }) | null | undefined,
): Promise<{ user?: User; error?: string }> {
  try {
    window.localStorage.setItem(HOME_CURRENCY_STORAGE_KEY, code);
  } catch {
    // Without storage the profile (when signed in) still keeps it.
  }
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
  if (!user || user.is_anonymous) return {};
  const { data, error } = await supabase.auth.updateUser({ data: { preferred_currency: code } });
  if (error) return { error: error.message };
  return { user: data.user ?? undefined };
}

export function getTripCurrency(context: TravelContext | undefined, preferred: CurrencyCode): CurrencyCode {
  return context?.currency ?? preferred;
}

/** The context a new trip is saved with: its own currency, or the preferred one. */
export function withTripCurrency(context: TravelContext | undefined, preferred: CurrencyCode): TravelContext {
  if (context?.currency) return context;
  return { ...(context ?? { version: 1 }), currency: preferred };
}

/** An amount in the trip currency, formatted for the current language. */
export function formatTripAmount(amount: number, currency: CurrencyCode, lang: string): string {
  return formatCurrency(amount, currency, lang);
}

/** The bare symbol of a currency in the current language ("€", "US$", "GBP"). */
export function currencySymbol(currency: CurrencyCode, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency }).formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Common currencies first, then every other ISO 4217 code the runtime knows, plus the current one. */
export function currencyChoices(current?: CurrencyCode): CurrencyCode[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [];
  const choices = [...HOME_CURRENCIES, ...all.filter((code) => !HOME_CURRENCIES.includes(code))];
  return current && !choices.includes(current) ? [current, ...choices] : choices;
}

/** "EUR · euro" in the current language. */
export function currencyLabel(code: CurrencyCode, lang: string): string {
  try {
    const name = new Intl.DisplayNames([lang], { type: "currency" }).of(code);
    return name && name !== code ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
}
