"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

const translations: Record<string, Record<string, string>> = { en, es };

type I18nContextType = {
  lang: string;
  setLang: (lang: string) => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState("en");

  useEffect(() => {
    const saved = localStorage.getItem("app_lang");
    if (saved && (saved === "en" || saved === "es")) {
      setLangState(saved);
    } else {
      const browserLang = navigator.language.toLowerCase();
      setLangState(browserLang.startsWith("es") ? "es" : "en");
    }
  }, []);

  const setLang = (newLang: string) => {
    localStorage.setItem("app_lang", newLang);
    setLangState(newLang);
  };

  const t = (key: string, variables?: Record<string, string | number>) => {
    let text = translations[lang]?.[key] || translations["en"]?.[key] || key;
    if (variables) {
      Object.keys(variables).forEach(v => {
        text = text.replace(new RegExp(`\\{${v}\\}`, 'g'), String(variables[v]));
      });
    }
    return text;
  };

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
};
