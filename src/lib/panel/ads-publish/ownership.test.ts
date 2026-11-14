import { describe, expect, it, vi, beforeEach } from "vitest";

const findTenant = vi.fn();
const findAd = vi.fn();
const findAdSet = vi.fn();
const findCampaign = vi.fn();
const useMock = vi.fn(() => false);

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findFirst: (...a: unknown[]) => findTenant(...a) },
    metaAd: { findFirst: (...a: unknown[]) => findAd(...a) },
    metaAdSet: { findFirst: (...a: unknown[]) => findAdSet(...a) },
    metaCampaign: { findFirst: (...a: unknown[]) => findCampaign(...a) },
  },
}));

vi.mock("@/lib/integrations/tokens", () => ({
  useMockPanelData: () => useMock(),
}));

vi.mock("@/lib/integrations/meta/structure-config", () => ({
  metaStructureInactiveMaxAgeDays: () => 180,
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
      campaignId: "c1",
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
    findAdSet.mockReset();
    findCampaign.mockReset();
    useMock.mockReturnValue(false);
    findTenant.mockResolvedValue({
      id: "t1",
      slug: "real-brand",
      metaAccountId: "act_111",
    });
    findCampaign.mockResolvedValue({
      id: "mc1",
      metaAccountId: "act_111",
    });
    findAdSet.mockResolvedValue({
      id: "ms1",
      campaignId: "c1",
      metaAccountId: "act_111",
      effectiveStatus: "ACTIVE",
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

  it("rejects empty campaignId", async () => {
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ campaignId: "" }),
      }),
    ).rejects.toMatchObject({ code: "empty_campaign_id" });
  });

  it("rejects unknown campaign node", async () => {
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ campaignId: "unknown" }),
      }),
    ).rejects.toMatchObject({ code: "empty_campaign_id" });
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
      effectiveStatus: "ACTIVE",
    });
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ adId: "12001", adAccountId: "act_111" }),
      }),
    ).rejects.toMatchObject({ code: "foreign_tenant" });
  });

  it("missing ad mentions age window", async () => {
    findAd.mockResolvedValue(null);
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ adId: "99999", adAccountId: "act_111" }),
      }),
    ).rejects.toMatchObject({ code: "outside_sync_window" });
    try {
      await assertTargetOwnership({
        tenantId: "t1",
        payload: payload({ adId: "99999", adAccountId: "act_111" }),
      });
    } catch (e) {
      expect((e as Error).message).toMatch(/180 günden eski/);
    }
  });

  it("accepts owned synced ad + campaign row", async () => {
    findAd.mockResolvedValue({
      tenantId: "t1",
      adsetId: "as1",
      campaignId: "c1",
      effectiveStatus: "PAUSED",
    });
    await expect(
      assertTargetOwnership({
        tenantId: "t1",
        payload: payload({
          adId: "12001",
          adsetId: "as1",
          campaignId: "c1",
          adAccountId: "act_111",
        }),
      }),
    ).resolves.toBeUndefined();
  });
});
