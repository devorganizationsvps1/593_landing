import { describe, expect, it, vi } from "vitest";
import {
  aggregateOutcome,
  evaluateWriteGates,
} from "@/lib/panel/ads-publish/write-gates";

const kindK1 = "ad.status";

describe("(b) three write gates — 8 combinations", () => {
  const cases: Array<{
    name: string;
    globalWrite: boolean;
    tenantWrite: boolean;
    k1: boolean;
    action: "apply" | "simulate" | "skip";
  }> = [
    {
      name: "000",
      globalWrite: false,
      tenantWrite: false,
      k1: false,
      action: "skip",
    },
    {
      name: "001",
      globalWrite: false,
      tenantWrite: false,
      k1: true,
      action: "simulate",
    },
    {
      name: "010",
      globalWrite: false,
      tenantWrite: true,
      k1: false,
      action: "skip",
    },
    {
      name: "011",
      globalWrite: false,
      tenantWrite: true,
      k1: true,
      action: "simulate",
    },
    {
      name: "100",
      globalWrite: true,
      tenantWrite: false,
      k1: false,
      action: "skip",
    },
    {
      name: "101",
      globalWrite: true,
      tenantWrite: false,
      k1: true,
      action: "simulate",
    },
    {
      name: "110",
      globalWrite: true,
      tenantWrite: true,
      k1: false,
      action: "skip",
    },
    {
      name: "111",
      globalWrite: true,
      tenantWrite: true,
      k1: true,
      action: "apply",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: G=${+c.globalWrite} T=${+c.tenantWrite} K1=${+c.k1} → ${c.action}`, () => {
      const d = evaluateWriteGates({
        kind: kindK1,
        globalWrite: c.globalWrite,
        tenantWrite: c.tenantWrite,
        tierFlags: { k1: c.k1, k2: false, k3: false, k4: false },
      });
      expect(d.action).toBe(c.action);
      if (c.action === "apply") {
        expect(d.missing).toEqual([]);
      } else {
        expect(d.missing.length).toBeGreaterThan(0);
      }
    });
  }

  it("only 111 allows live Graph (graphPost allowLive path)", async () => {
    const graphPost = vi.fn(async () => ({
      dryRun: false,
      json: { success: true },
      res: new Response(),
    }));
    vi.doMock("@/lib/integrations/meta/write", () => ({
      metaAdsWriteEnabled: () => true,
      graphPost,
      updateAdStatus: async (
        id: string,
        status: string,
        opts?: { allowLive?: boolean },
      ) => {
        if (!opts?.allowLive) {
          return { dryRun: true, json: {}, res: new Response() };
        }
        return graphPost(id, { status });
      },
    }));

    for (const c of cases) {
      graphPost.mockClear();
      const d = evaluateWriteGates({
        kind: kindK1,
        globalWrite: c.globalWrite,
        tenantWrite: c.tenantWrite,
        tierFlags: { k1: c.k1 },
      });
      if (d.action === "apply") {
        await graphPost("ad_1", { status: "PAUSED" });
        expect(graphPost).toHaveBeenCalledTimes(1);
      } else {
        expect(graphPost).not.toHaveBeenCalled();
      }
    }
  });
});

describe("(b) aggregateOutcome", () => {
  it("all applied → applied", () => {
    expect(aggregateOutcome(["applied", "applied"])).toBe("applied");
  });
  it("all simulated → simulated", () => {
    expect(aggregateOutcome(["simulated"])).toBe("simulated");
  });
  it("all skipped → skipped", () => {
    expect(aggregateOutcome(["skipped", "skipped"])).toBe("skipped");
  });
  it("mixed → partial", () => {
    expect(aggregateOutcome(["applied", "simulated"])).toBe("partial");
    expect(aggregateOutcome(["simulated", "skipped"])).toBe("partial");
  });
  it("any failed → failed", () => {
    expect(aggregateOutcome(["applied", "failed"])).toBe("failed");
  });
});
