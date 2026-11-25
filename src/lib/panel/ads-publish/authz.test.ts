import { describe, expect, it, vi, beforeEach } from "vitest";

const packageFind = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    membership: { findFirst: vi.fn() },
    adChangePackage: { findFirst: (...a: unknown[]) => packageFind(...a) },
  },
}));

import {
  assertCanApprovePackage,
  assertCanEditTenant,
} from "@/lib/panel/ads-publish/authz";

describe("(d) authz — admin panel, no membership gate for team edit", () => {
  beforeEach(() => {
    packageFind.mockReset();
  });

  it("allowlist team (Muhammet) can edit any tenant without membership row", async () => {
    await expect(
      assertCanEditTenant(
        { id: "u1", name: "Muhammet", email: "muhammet@x", role: "team" },
        "t1",
      ),
    ).resolves.toBeUndefined();
  });

  it("non-allowlist team cannot edit", async () => {
    await expect(
      assertCanEditTenant(
        { id: "u1", name: "Ali", email: "a@x", role: "team" },
        "t1",
      ),
    ).rejects.toMatchObject({ code: "not_approver" });
  });

  it("non-allowlist admin cannot edit", async () => {
    await expect(
      assertCanEditTenant(
        { id: "a1", name: "Admin", email: "a@x", role: "admin" },
        "t1",
      ),
    ).rejects.toMatchObject({ code: "not_approver" });
  });

  it("client cannot edit", async () => {
    await expect(
      assertCanEditTenant(
        { id: "c1", name: "Client", email: "c@x", role: "client" },
        "t1",
      ),
    ).rejects.toMatchObject({ code: "client_forbidden" });
  });

  it("self-approve by creator is rejected", async () => {
    packageFind.mockResolvedValue({
      createdById: "u1",
      versions: [{ createdById: "u2" }],
    });
    await expect(
      assertCanApprovePackage({
        actor: { id: "u1", name: "Muhammet", email: "muhammet@x", role: "admin" },
        packageId: "p1",
      }),
    ).rejects.toMatchObject({ code: "self_approve" });
  });

  it("source: no membership.findFirst in assertCanEditTenant", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/authz.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/membership\.findFirst/);
    expect(src).toMatch(/canAccessAdsPublish/);
    expect(src).toMatch(/role !== "team"/);
  });
});
