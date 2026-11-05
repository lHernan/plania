"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, HelpCircle, LogIn, LogOut, Luggage, Monitor, Moon, Sun, User as UserIcon } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";

export type ThemeMode = "light" | "dark" | "system";

/** The key stays `plania_theme` so saved preferences survive the rename to Tachao. */
const THEME_KEY = "plania_theme";

export function readTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Puts the `dark` class on <html>; `system` follows the device preference. */
export function applyTheme(mode: ThemeMode) {
  const dark = mode === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : mode === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

/** Remembers the theme on this device and applies it. */
export function saveTheme(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Still applied for this visit.
  }
  applyTheme(mode);
}

const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
] as const;

/**
 * The avatar in the header: my trips, profile, language, theme, the tour and signing in or out.
 * `email` is null for anonymous visitors, who get "sign in" instead of "sign out".
 * Without `onStartTour` (screens with no trip to tour) the tour item is left out.
 */
export function AccountMenu({
  email,
  onStartTour,
  onSignOut,
  onSignIn,
}: {
  email: string | null;
  onStartTour?: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
}) {
  const { lang, setLang, t } = useI18n();
  const signedIn = email !== null;
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    list[(current + step + list.length) % list.length]?.focus();
  };

  const run = (action: () => void) => () => {
    close();
    action();
  };

  const themes: { mode: ThemeMode; label: string; icon: ReactNode }[] = [
    { mode: "light", label: t("account_menu_theme_light"), icon: <Sun size={14} aria-hidden="true" /> },
    { mode: "dark", label: t("account_menu_theme_dark"), icon: <Moon size={14} aria-hidden="true" /> },
    { mode: "system", label: t("account_menu_theme_system"), icon: <Monitor size={14} aria-hidden="true" /> },
  ];

  const itemClass =
    "flex w-full min-h-11 items-center gap-2.5 rounded-xl px-3 text-left text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-subtle)]";
  const groupLabelClass = "px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-[var(--color-text-muted)]";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-tour="tour-help"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("account_menu_label")}
        title={t("account_menu_label")}
        onClick={() => {
          if (!open) setTheme(readTheme());
          setOpen((value) => !value);
        }}
        className="size-11 shrink-0 rounded-full flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
      >
        <span className="size-8 rounded-full bg-[var(--color-primary-subtle)] flex items-center justify-center text-[var(--color-primary)] border border-[var(--color-primary)]/20 text-xs font-black uppercase">
          {email ? email.charAt(0) : <UserIcon size={14} aria-hidden="true" />}
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t("account_menu_label")}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-xl"
        >
          <p className="truncate px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
            {signedIn ? email : t("account_menu_guest")}
          </p>
          <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />

          <Link href="/trips" role="menuitem" tabIndex={-1} onClick={() => close(false)} className={itemClass}>
            <Luggage size={14} aria-hidden="true" />
            {t("account_menu_my_trips")}
          </Link>
          <Link href="/me" role="menuitem" tabIndex={-1} onClick={() => close(false)} className={itemClass}>
            <UserIcon size={14} aria-hidden="true" />
            {t("account_menu_profile")}
          </Link>
          <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />

          <div role="group" aria-label={t("account_menu_language")}>
            <p className={groupLabelClass} aria-hidden="true">{t("account_menu_language")}</p>
            {LANGUAGES.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={lang === code}
                tabIndex={-1}
                onClick={run(() => setLang(code))}
                className={itemClass}
              >
                <span className="w-4 shrink-0">{lang === code && <Check size={14} aria-hidden="true" />}</span>
                {label}
              </button>
            ))}
          </div>

          <div role="group" aria-label={t("account_menu_theme")}>
            <p className={groupLabelClass} aria-hidden="true">{t("account_menu_theme")}</p>
            {themes.map(({ mode, label, icon }) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={theme === mode}
                tabIndex={-1}
                onClick={run(() => {
                  saveTheme(mode);
                  setTheme(mode);
                })}
                className={itemClass}
              >
                <span className="w-4 shrink-0">{theme === mode && <Check size={14} aria-hidden="true" />}</span>
                {icon}
                {label}
              </button>
            ))}
          </div>

          <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />
          {onStartTour && (
            <button type="button" role="menuitem" tabIndex={-1} onClick={run(onStartTour)} className={itemClass}>
              <HelpCircle size={14} aria-hidden="true" />
              {t("tour_help")}
            </button>
          )}
          {signedIn ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={run(onSignOut)}
              className={`${itemClass} text-[var(--color-danger)]`}
            >
              <LogOut size={14} aria-hidden="true" />
              {t("logout")}
            </button>
          ) : (
            <button type="button" role="menuitem" tabIndex={-1} onClick={run(onSignIn)} className={itemClass}>
              <LogIn size={14} aria-hidden="true" />
              {t("auth_login")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
