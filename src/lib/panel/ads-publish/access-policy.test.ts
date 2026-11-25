import { describe, expect, it } from "vitest";
import {
  ADS_PUBLISH_PEOPLE,
  canAccessAdsPublish,
} from "@/lib/panel/ads-publish/access-policy";

describe("ads-publish allowlist (Muhammet-only)", () => {
  it("only lists Muhammet for now", () => {
    expect([...ADS_PUBLISH_PEOPLE]).toEqual(["Muhammet"]);
  });

  it("allows Muhammet by name or email local-part", () => {
    expect(
      canAccessAdsPublish({ name: "Muhammet Akpınar", email: "x@y", role: "team" }),
    ).toBe(true);
    expect(
      canAccessAdsPublish({
        name: "X",
        email: "muhammet@593emarketing.com",
        role: "admin",
      }),
    ).toBe(true);
  });

  it("denies other staff and clients even if admin", () => {
    expect(
      canAccessAdsPublish({ name: "Hakan", email: "hakan@x", role: "admin" }),
    ).toBe(false);
    expect(
      canAccessAdsPublish({ name: "Numan", email: "numan@x", role: "team" }),
    ).toBe(false);
    expect(
      canAccessAdsPublish({ name: "Muhammet", email: "m@x", role: "client" }),
    ).toBe(false);
  });
});
