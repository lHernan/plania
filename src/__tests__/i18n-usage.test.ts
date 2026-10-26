import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

// Literal keys passed to t("...") anywhere in the app.
const usedKeys = [
  ...new Set(
    sourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bt\(\s*["']([a-zA-Z0-9_]+)["']/g)].map((m) => m[1])
    )
  ),
].sort();

describe("i18n usage", () => {
  it("finds translated keys in the source", () => {
    expect(usedKeys.length).toBeGreaterThan(100);
  });

  it.each([
    ["en", en],
    ["es", es],
  ] as const)("every key used with t() exists in %s.json", (_lang, dict) => {
    const missing = usedKeys.filter((key) => !(key in dict));
    expect(missing).toEqual([]);
  });

  it("has no empty translations", () => {
    for (const dict of [en, es] as Record<string, string>[]) {
      expect(Object.entries(dict).filter(([, value]) => !value.trim())).toEqual([]);
    }
  });
});
