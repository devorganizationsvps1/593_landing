import { describe, expect, it } from "vitest";
import {
  allowedWriteKinds,
  isWriteKindAllowed,
  stepIdempotencyKey,
} from "@/lib/panel/ads-publish/write-kinds";
import {
  isAdStatusStale,
  statusStaleMessage,
} from "@/lib/panel/ads-publish/stale-check";

describe("(a) write-kinds allowlist", () => {
  it("default flags yield empty allowlist — no kind applies", () => {
    const set = allowedWriteKinds({});
    expect(set.size).toBe(0);
    expect(isWriteKindAllowed("ad.status", {})).toBe(false);
    expect(isWriteKindAllowed("adset.daily_budget", {})).toBe(false);
    expect(isWriteKindAllowed("adset.targeting", {})).toBe(false);
  });

  it("K1 flag enables only status and budget kinds", () => {
    expect(isWriteKindAllowed("ad.status", { k1: true })).toBe(true);
    expect(isWriteKindAllowed("adset.status", { k1: true })).toBe(true);
    expect(isWriteKindAllowed("adset.daily_budget", { k1: true })).toBe(true);
    expect(isWriteKindAllowed("creative.headline", { k1: true })).toBe(false);
    expect(isWriteKindAllowed("adset.targeting", { k1: true })).toBe(false);
  });
});

describe("(a) step idempotency key", () => {
  it("is stable per kind + target", () => {
    expect(
      stepIdempotencyKey("ad.status", { adId: "123" }),
    ).toBe("ad.status:123");
    expect(
      stepIdempotencyKey("adset.daily_budget", { adsetId: "99" }),
    ).toBe("adset.daily_budget:99");
  });
});

describe("(a) status stale check", () => {
  it("detects mismatch between package current and live effective status", () => {
    expect(
      isAdStatusStale({
        packageCurrent: "ACTIVE",
        liveStatus: "PAUSED",
        liveEffectiveStatus: "PAUSED",
      }),
    ).toBe(true);
  });

  it("is not stale when current matches live", () => {
    expect(
      isAdStatusStale({
        packageCurrent: "PAUSED",
        liveStatus: "PAUSED",
        liveEffectiveStatus: "PAUSED",
      }),
    ).toBe(false);
  });

  it("message includes both values", () => {
    const msg = statusStaleMessage({
      packageCurrent: "ACTIVE",
      liveStatus: "PAUSED",
      liveEffectiveStatus: "CAMPAIGN_PAUSED",
    });
    expect(msg).toMatch(/CAMPAIGN_PAUSED/);
    expect(msg).toMatch(/ACTIVE/);
  });
});

describe("(a) claim semantics (documented)", () => {
  it("claim uses updateMany queued→running pattern (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/job-runner.ts"),
      "utf8",
    );
    expect(src).toMatch(/updateMany/);
    expect(src).toMatch(/status:\s*"queued"/);
    expect(src).toMatch(/status:\s*"running"/);
    expect(src).toMatch(/count === 1/);
    // Eski deferred fallthrough yok
    expect(src).not.toMatch(/deferred:\s*true/);
    expect(src).toMatch(/kind_not_in_allowlist/);
  });
});
