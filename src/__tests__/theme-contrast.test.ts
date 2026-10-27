import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * --color-text is dark in the light theme and light in the dark theme, so a solid
 * bg-[var(--color-text)] surface needs text that flips too (--color-surface / --color-bg),
 * never a fixed white that disappears in dark mode.
 */
const SOLID_TEXT_BG = /bg-\[var\(--color-text\)\](?!\/)/;
const FIXED_WHITE = /(^|[\s"`])text-white([\s"`/]|$)/;

describe("theme contrast", () => {
  it("no solid text-colored surface uses fixed white text", () => {
    const dir = path.resolve(__dirname, "../components");
    const offenders: string[] = [];
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx"))) {
      const lines = readFileSync(path.join(dir, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        // Each quoted class list on its own: a ternary may pair another background with white.
        for (const classes of line.match(/"[^"]*"|`[^`]*`/g) ?? []) {
          if (SOLID_TEXT_BG.test(classes) && FIXED_WHITE.test(classes) && !classes.includes("dark:text-")) {
            offenders.push(`${file}:${index + 1}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
