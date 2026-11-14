import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/panel/ads-publish/write-kinds";

describe("approval preview fingerprint stability", () => {
  it("same payload → same hash", () => {
    const body = {
      packageId: "p1",
      version: 2,
      versionId: "v1",
      target: { campaignId: "c1", adsetId: null, adId: null },
      impact: { adsetCount: 3, adCount: 10 },
      changes: [
        {
          field: "ad.status",
          label: "Reklam durumu",
          current: "ACTIVE",
          proposed: "PAUSED",
        },
      ],
    };
    const a = createHash("sha256").update(stableStringify(body)).digest("hex");
    const b = createHash("sha256").update(stableStringify(body)).digest("hex");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
