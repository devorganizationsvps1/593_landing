import { describe, expect, it } from "vitest";
import {
  assertBudgetDeltaAllowed,
  assertPayloadBudgetLimits,
  BudgetCheckError,
  isBudgetStale,
} from "@/lib/panel/ads-publish/budget-check";
import {
  budgetsEqualMetaMinor,
  majorToMetaMinor,
  packageBudgetToMetaMinor,
  parseMetaBudgetMinor,
} from "@/lib/panel/ads-publish/budget-units";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";

function payload(partial: {
  current: unknown;
  proposed: unknown;
}): AdChangePayload {
  return {
    target: {
      tenantId: "t",
      platform: "meta",
      adAccountId: "act_1",
      adsetId: "adset_1",
    },
    rationale: {
      dateStart: "",
      dateEnd: "",
      conversionMetric: "",
      spend: null,
      conversions: null,
      cpa: null,
      roas: null,
      targetCpa: null,
      targetRoas: null,
      notes: "",
    },
    changes: [
      {
        field: "adset.daily_budget",
        label: "Günlük bütçe",
        current: partial.current,
        proposed: partial.proposed,
      },
    ],
    plan: [{ key: "adset.daily_budget", label: "Günlük bütçe" }],
    media: [],
  };
}

describe("(c) budget units", () => {
  it("compares in Meta minor with integer equality via single helper", () => {
    expect(majorToMetaMinor(100)).toBe(10_000);
    expect(packageBudgetToMetaMinor(100)).toBe(10_000);
    expect(parseMetaBudgetMinor("10000")).toBe(10_000);
    expect(budgetsEqualMetaMinor(10_000, 10_000)).toBe(true);
    expect(budgetsEqualMetaMinor(10_000, 10_001)).toBe(false);
  });
});

describe("(c) budget stale → re-approve signal", () => {
  it("detects stale when package current ≠ live minor", () => {
    expect(
      isBudgetStale({
        packageCurrentMinor: 10_000,
        liveDailyBudgetMinor: 12_000,
      }),
    ).toBe(true);
    expect(
      isBudgetStale({
        packageCurrentMinor: 10_000,
        liveDailyBudgetMinor: 10_000,
      }),
    ).toBe(false);
  });

  it("live null daily budget counts as stale/missing", () => {
    expect(
      isBudgetStale({
        packageCurrentMinor: 10_000,
        liveDailyBudgetMinor: null,
      }),
    ).toBe(true);
  });
});

describe("(c) budget delta limit", () => {
  it("rejects when change exceeds default 20%", () => {
    expect(() =>
      assertBudgetDeltaAllowed({
        currentMinor: 10_000,
        proposedMinor: 13_000, // +30%
        maxPct: 20,
      }),
    ).toThrow(BudgetCheckError);
    try {
      assertBudgetDeltaAllowed({
        currentMinor: 10_000,
        proposedMinor: 13_000,
        maxPct: 20,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetCheckError);
      expect((e as BudgetCheckError).code).toBe("delta_exceeded");
    }
  });

  it("allows within 20%", () => {
    expect(() =>
      assertBudgetDeltaAllowed({
        currentMinor: 10_000,
        proposedMinor: 11_500,
        maxPct: 20,
      }),
    ).not.toThrow();
  });

  it("create-time payload check rejects over-limit", () => {
    expect(() =>
      assertPayloadBudgetLimits(payload({ current: 100, proposed: 150 })),
    ).toThrow(/sınırı/);
  });
});

describe("(c) no daily budget on adset → reject", () => {
  it("parseMetaBudgetMinor empty → null (reject path)", () => {
    expect(parseMetaBudgetMinor(null)).toBeNull();
    expect(parseMetaBudgetMinor("")).toBeNull();
    expect(parseMetaBudgetMinor(undefined)).toBeNull();
  });

  it("assertPayloadBudgetLimits rejects missing current daily", () => {
    try {
      assertPayloadBudgetLimits(payload({ current: null, proposed: 100 }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetCheckError);
      expect((e as BudgetCheckError).code).toBe("no_daily_budget");
    }
  });

  it("job-runner rejects no_daily_budget instead of silent skip (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const check = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/budget-check.ts"),
      "utf8",
    );
    expect(check).toMatch(/no_daily_budget/);
    expect(check).toMatch(/kampanya düzeyi veya lifetime/);
    const runner = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(runner).toMatch(/assertLiveBudgetBeforeApply/);
    expect(runner).not.toMatch(/skipped:\s*true,\s*reason:\s*"invalid budget"/);
  });
});
