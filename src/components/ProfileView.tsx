"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, HelpCircle, LogIn, LogOut, Monitor, Moon, Share2, Sun } from "lucide-react";
import { applyTheme, readTheme, saveTheme, type ThemeMode } from "@/components/AccountMenu";
import { AuthModal } from "@/components/AuthModal";
import { useI18n } from "@/components/I18nProvider";
import { TOUR_SEEN_KEY } from "@/components/ProductTour";
import { tripPath } from "@/lib/trip-routes";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

const noSubscription = () => () => {};

const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--color-text-muted)]">{title}</h2>
      {children}
    </section>
  );
}

/** One choice of a radio group, as a 44px row with a check. */
function Choice({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
        checked
          ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
      }`}
    >
      {checked && <Check size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}

/**
 * Perfil (/me): account, language, theme, the tour of the current trip and signing in or out.
 * The language and theme are the same preferences the avatar menu changes.
 */
export function ProfileView() {
  const { lang, setLang, t } = useI18n();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const activeTrip = useItineraryStore((s) => s.activeTrip);
  // The saved theme (read after hydration), until a choice is made here.
  const savedTheme = useSyncExternalStore(noSubscription, readTheme, () => "system" as ThemeMode);
  const [chosenTheme, setChosenTheme] = useState<ThemeMode | null>(null);
  const theme = chosenTheme ?? savedTheme;
  const [showAuthModal, setShowAuthModal] = useState(false);
  const email = user && !user.is_anonymous ? user.email ?? "" : null;

  useEffect(() => {
    applyTheme(readTheme());
  }, []);

  // The trip screen starts the tour by itself when it has not been seen on this device.
  const replayTour = () => {
    if (!activeTrip) return;
    try {
      window.localStorage.removeItem(TOUR_SEEN_KEY);
    } catch {
      // Without storage the trip screen already shows the tour on every visit.
    }
    router.push(tripPath(activeTrip.id));
  };

  const themes: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
    { mode: "light", label: t("account_menu_theme_light"), icon: <Sun size={14} aria-hidden="true" /> },
    { mode: "dark", label: t("account_menu_theme_dark"), icon: <Moon size={14} aria-hidden="true" /> },
    { mode: "system", label: t("account_menu_theme_system"), icon: <Monitor size={14} aria-hidden="true" /> },
  ];
  const rowClass =
    "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]";

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-3">
          <Link
            href="/trips"
            aria-label={t("my_trips_title")}
            title={t("my_trips_title")}
            className="flex size-11 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
          <h1 className="text-lg font-black tracking-tight text-[var(--color-text)] font-[family-name:var(--font-display)]">
            {t("profile_title")}
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
        <Section title={t("profile_account")}>
          {email !== null ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--color-text-muted)]">{t("profile_signed_in_as")}</p>
              <p className="truncate text-sm font-bold text-[var(--color-text)]">{email}</p>
              <Link href="/trips" className={rowClass}>
                <Share2 size={14} aria-hidden="true" />
                {t("profile_shared_trips")}
              </Link>
              <button type="button" onClick={() => void signOut()} className={`${rowClass} text-[var(--color-danger)]`}>
                <LogOut size={14} aria-hidden="true" />
                {t("logout")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">{t("profile_guest_body")}</p>
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-xs font-black text-white hover:bg-[var(--color-primary-hover)]"
              >
                <LogIn size={14} aria-hidden="true" />
                {t("auth_login")}
              </button>
            </div>
          )}
        </Section>

        <Section title={t("account_menu_language")}>
          <div role="radiogroup" aria-label={t("account_menu_language")} className="flex gap-2">
            {LANGUAGES.map(({ code, label }) => (
              <Choice key={code} checked={lang === code} onSelect={() => setLang(code)}>
                {label}
              </Choice>
            ))}
          </div>
        </Section>

        <Section title={t("account_menu_theme")}>
          <div role="radiogroup" aria-label={t("account_menu_theme")} className="flex gap-2">
            {themes.map(({ mode, label, icon }) => (
              <Choice
                key={mode}
                checked={theme === mode}
                onSelect={() => {
                  saveTheme(mode);
                  setChosenTheme(mode);
                }}
              >
                {icon}
                {label}
              </Choice>
            ))}
          </div>
        </Section>

        {activeTrip && (
          <Section title={t("profile_help")}>
            <button type="button" onClick={replayTour} className={rowClass}>
              <HelpCircle size={14} aria-hidden="true" />
              {t("tour_help")}
            </button>
          </Section>
        )}
      </div>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onShowToast={() => {}} />
    </main>
  );
}
