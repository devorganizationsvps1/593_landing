import { describe, expect, it } from "vitest";
import { isMetaAdVisibleOnLegacyScreens } from "@/lib/panel/meta-ad-visibility";

describe("isMetaAdVisibleOnLegacyScreens", () => {
  it("ACTIVE effective → visible", () => {
    expect(
      isMetaAdVisibleOnLegacyScreens({
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("status ACTIVE but campaign paused (CAMPAIGN_PAUSED) → hidden", () => {
    expect(
      isMetaAdVisibleOnLegacyScreens({
        status: "ACTIVE",
        effectiveStatus: "CAMPAIGN_PAUSED",
      }),
    ).toBe(false);
  });

  it("uses effectiveStatus not status", () => {
    expect(
      isMetaAdVisibleOnLegacyScreens({
        status: "PAUSED",
        effectiveStatus: "ACTIVE",
      }),
    ).toBe(true);
  });
});
