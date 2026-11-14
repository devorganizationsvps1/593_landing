import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/panel/ads-publish/write-kinds";
import { formatBudgetLabel } from "@/lib/panel/ads-publish/approval-preview";

describe("approval preview fingerprint stability", () => {
  it("same payload → same hash; currency in body", () => {
    const body = {
      packageId: "p1",
      version: 2,
      versionId: "v1",
      currency: "USD",
      target: { campaignId: "c1", adsetId: null, adId: null },
      impact: { adsetCount: 3, adCount: 10 },
      changes: [
        {
          field: "ad.status",
          label: "Reklam durumu",
          current: "ACTIVE",
          proposed: "PAUSED",
          currentFromLive: true,
        },
      ],
      liveReadOk: true,
    };
    const a = createHash("sha256").update(stableStringify(body)).digest("hex");
    const b = createHash("sha256").update(stableStringify(body)).digest("hex");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("USD account label uses USD not TRY", () => {
    expect(formatBudgetLabel(50, "USD")).toBe("50 USD/gün");
    expect(formatBudgetLabel(50, "TRY")).toBe("50 TRY/gün");
  });
});
