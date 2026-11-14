import { describe, expect, it, vi, beforeEach } from "vitest";

const findTenant = vi.fn();
const findAd = vi.fn();
const findAdsetInsight = vi.fn();
const findInsight = vi.fn();
const useMock = vi.fn(() => false);

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findFirst: (...a: unknown[]) => findTenant(...a) },
    metaAd: { findFirst: (...a: unknown[]) => findAd(...a) },
    metaAdsetInsight: { findFirst: (...a: unknown[]) => findAdsetInsight(...a) },
    metaInsight: { findFirst: (...a: unknown[]) => findInsight(...a) },
  },
}));

vi.mock("@/lib/integrations/tokens", () => ({
  useMockPanelData: () => useMock(),
}));

import {
  assertTargetOwnership,
  looksLikeMockMetaId,
  OwnershipError,
} from "@/lib/panel/ads-publish/ownership";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";

function payload(target: Partial<AdChangePayload["target"]>): AdChangePayload {
  return {
    target: {
      tenantId: "t1",
      platform: "meta",
      adAccountId: "act_111",
      ...target,
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
    changes: [],
    plan: [],
    media: [],
  };
}

describe("(e) ownership", () => {
  beforeEach(() => {
    findTenant.mockReset();
    findAd.mockReset();
    findAdsetInsight.mockReset();
    findInsight.mockReset();
    useMock.mockReturnValue(false);
    findTenant.mockResolvedValue({
      id: "t1",
      slug: "real-brand",
      metaAccountId: "act_111",
    });
  });

  it("detects mock ids", () => {
    expect(looksLikeMockMetaId("mock_ad_1")).toBe(true);
    expect(looksLikeMockMetaId("12033")).toBe(false);
  });

  it("rejects mock mode", async () => {
    useMock.mockReturnValue(true);
    await expect(
      assertTargetOwnership({ tenantId: "t1", payload: payload({}) }),
    ).rejects.toMatchObject({ code: "mock_mode" });
  });

  it("rejects mock Meta ID", async () => {
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ adId: "mock_ad_99" }),
      }),
    ).rejects.toBeInstanceOf(OwnershipError);
  });

  it("rejects other tenant ad id", async () => {
    findAd.mockResolvedValue({
      tenantId: "other",
      adsetId: "as1",
      campaignId: "c1",
    });
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ adId: "12001", adAccountId: "act_111" }),
      }),
    ).rejects.toMatchObject({ code: "foreign_tenant" });
  });

  it("rejects id not in synced records", async () => {
    findAd.mockResolvedValue(null);
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ adId: "99999", adAccountId: "act_111" }),
      }),
    ).rejects.toMatchObject({ code: "ad_not_found" });
  });

  it("accepts owned synced ad", async () => {
    findAd.mockResolvedValue({
      tenantId: "t1",
      adsetId: "as1",
      campaignId: "c1",
    });
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({
          adId: "12001",
          adsetId: "as1",
          adAccountId: "act_111",
        }),
      }),
    ).resolves.toBeUndefined();
  });
});
