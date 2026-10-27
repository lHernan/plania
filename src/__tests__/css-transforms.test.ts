import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

describe("CSS transforms", () => {
  it("never use the misspelled transtone(), which makes the browser drop the whole transform", () => {
    const dir = path.resolve(__dirname, "../components");
    const offenders = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx") && readFileSync(path.join(dir, file), "utf8").includes("transtone"));
    expect(offenders).toEqual([]);
  });
});
