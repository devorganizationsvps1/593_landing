/**
 * Durdurulmuş MetaAd satırları mevcut ekranları bozmasın.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("MetaAd legacy screens filter ACTIVE", () => {
  it("active-campaigns / brand-budget / data only query ACTIVE MetaAd", () => {
    const files = [
      "src/lib/panel/active-campaigns.ts",
      "src/lib/panel/brand-budget.ts",
      "src/lib/panel/data.ts",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src).toMatch(/effectiveStatus:\s*["']ACTIVE["']/);
    }
  });

  it("setup-checks already ACTIVE-only", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/setup-checks.ts"),
      "utf8",
    );
    expect(src).toMatch(/effectiveStatus:\s*["']ACTIVE["']/);
  });

  it("ads-publish tree keeps non-ACTIVE (restartable)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/meta-account-ads.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/effectiveStatus:\s*["']ACTIVE["']/);
  });
});
