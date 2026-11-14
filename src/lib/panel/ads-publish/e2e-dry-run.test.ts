/**
 * Dry-run E2E kabul — kapılar kapalıyken Graph yazımı yok.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  aggregateOutcome,
  evaluateWriteGates,
} from "@/lib/panel/ads-publish/write-gates";
import { assertBudgetDeltaAllowed, BudgetCheckError } from "@/lib/panel/ads-publish/budget-check";
import { isBudgetStale } from "@/lib/panel/ads-publish/budget-check";

const graphFetch = vi.fn();

vi.mock("@/lib/integrations/meta/graph", () => ({
  MetaGraphError: class extends Error {
    status: number;
    code: number | null;
    constructor(message: string, status: number, code: number | null = null) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  graphFetch: (...a: unknown[]) => graphFetch(...a),
}));

vi.mock("@/lib/integrations/tokens", () => ({
  getMetaSystemUserToken: () => "token",
  useMockPanelData: () => false,
}));

vi.mock("@/lib/panel/audit", () => ({
  audit: vi.fn(async () => undefined),
}));

describe("dry-run E2E acceptance", () => {
  const prevWrite = process.env.META_ADS_WRITE;

  beforeEach(() => {
    graphFetch.mockReset();
    process.env.META_ADS_WRITE = ""; // kapalı
  });

  afterEach(() => {
    process.env.META_ADS_WRITE = prevWrite;
  });

  it("team path: status+budget → simulate when gates off; package simulated; zero Graph POST", async () => {
    const kinds = ["ad.status", "adset.daily_budget"];
    const flags = { k1: false, k2: false, k3: false, k4: false };
    const stepOutcomes = kinds.map((kind) => {
      const d = evaluateWriteGates({
        kind,
        globalWrite: false,
        tenantWrite: false,
        tierFlags: flags,
      });
      expect(d.action).toBe("skip"); // K1 kapalı → skip
      return d.action === "skip"
        ? ("skipped" as const)
        : d.action === "simulate"
          ? ("simulated" as const)
          : ("applied" as const);
    });

    // K1 açık ama global/tenant kapalı → simulate (asıl dry-run senaryosu)
    const withK1 = kinds.map((kind) => {
      const d = evaluateWriteGates({
        kind,
        globalWrite: false,
        tenantWrite: false,
        tierFlags: { k1: true },
      });
      expect(d.action).toBe("simulate");
      expect(d.missing.length).toBeGreaterThan(0);
      return "simulated" as const;
    });
    expect(aggregateOutcome(withK1)).toBe("simulated");
    expect(aggregateOutcome(stepOutcomes)).toBe("skipped");

    const { graphPost } = await import("@/lib/integrations/meta/write");
    const r = await graphPost("12001", { status: "PAUSED" }, { allowLive: false });
    expect(r.dryRun).toBe(true);
    expect(graphFetch).not.toHaveBeenCalled();

    // allowLive true ama META_ADS_WRITE kapalı → hâlâ dry-run, Graph yok
    const r2 = await graphPost("12001", { status: "PAUSED" }, { allowLive: true });
    expect(r2.dryRun).toBe(true);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it("negative: stale budget → re-approve signal", () => {
    expect(
      isBudgetStale({
        packageCurrentMinor: 10_000,
        liveDailyBudgetMinor: 15_000,
      }),
    ).toBe(true);
  });

  it("negative: delta over limit → reject", () => {
    expect(() =>
      assertBudgetDeltaAllowed({
        currentMinor: 10_000,
        proposedMinor: 15_000,
        maxPct: 20,
      }),
    ).toThrow(BudgetCheckError);
  });

  it("negative: K2 kind skipped when only K1 on", () => {
    const d = evaluateWriteGates({
      kind: "creative.headline",
      globalWrite: true,
      tenantWrite: true,
      tierFlags: { k1: true, k2: false },
    });
    expect(d.action).toBe("skip");
    expect(d.missing[0]).toMatch(/tier_K2|kind_not/);
  });

  it("audit trail actions exist for create → submit → approve → job (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const packages = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/packages.ts"),
      "utf8",
    );
    expect(packages).toMatch(/ad_change\.create/);
    expect(packages).toMatch(/ad_change\.submit/);
    expect(packages).toMatch(/ad_change\.approve/);
    const runner = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(runner).toMatch(/status: "simulated"/);
    expect(runner).toMatch(/reasonLabel/);
  });
});
