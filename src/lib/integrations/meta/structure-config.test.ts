import { describe, expect, it } from "vitest";
import {
  isWithinInactiveAgeWindow,
  shouldSyncStructureEntity,
} from "@/lib/integrations/meta/structure-config";

describe("structure inactive age window", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");

  it("ACTIVE always syncs", () => {
    expect(
      shouldSyncStructureEntity({
        effectiveStatus: "ACTIVE",
        updatedTime: null,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("PAUSED within window syncs", () => {
    expect(
      shouldSyncStructureEntity({
        effectiveStatus: "PAUSED",
        updatedTime: "2026-10-01T00:00:00Z",
        maxAgeDays: 180,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("PAUSED older than window skipped", () => {
    expect(
      shouldSyncStructureEntity({
        effectiveStatus: "PAUSED",
        updatedTime: "2025-01-01T00:00:00Z",
        maxAgeDays: 180,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("parses unix seconds", () => {
    const recentSec = Math.floor(now / 1000) - 7 * 24 * 60 * 60;
    expect(isWithinInactiveAgeWindow(recentSec, 180, now)).toBe(true);
  });
});
