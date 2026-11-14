import { describe, expect, it, vi, beforeEach } from "vitest";

const membershipFind = vi.fn();
const packageFind = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    membership: { findFirst: (...a: unknown[]) => membershipFind(...a) },
    adChangePackage: { findFirst: (...a: unknown[]) => packageFind(...a) },
  },
}));

import {
  assertCanApprovePackage,
  assertCanEditTenant,
  AuthzError,
} from "@/lib/panel/ads-publish/authz";

describe("(d) authz", () => {
  beforeEach(() => {
    membershipFind.mockReset();
    packageFind.mockReset();
  });

  it("non-member team cannot edit", async () => {
    membershipFind.mockResolvedValue(null);
    await expect(
      assertCanEditTenant(
        { id: "u1", name: "Ali", email: "a@x", role: "team" },
        "t1",
      ),
    ).rejects.toMatchObject({ code: "not_member" });
  });

  it("admin can edit any tenant", async () => {
    await expect(
      assertCanEditTenant(
        { id: "a1", name: "Admin", email: "a@x", role: "admin" },
        "t1",
      ),
    ).resolves.toBeUndefined();
    expect(membershipFind).not.toHaveBeenCalled();
  });

  it("self-approve by creator is rejected", async () => {
    packageFind.mockResolvedValue({
      createdById: "u1",
      versions: [{ createdById: "u2" }],
    });
    await expect(
      assertCanApprovePackage({
        actor: { id: "u1", name: "Hakan", email: "h@x", role: "admin" },
        packageId: "p1",
      }),
    ).rejects.toMatchObject({ code: "self_approve" });
  });

  it("self-approve by last editor is rejected", async () => {
    packageFind.mockResolvedValue({
      createdById: "other",
      versions: [{ createdById: "u1" }],
    });
    await expect(
      assertCanApprovePackage({
        actor: { id: "u1", name: "Hakan", email: "h@x", role: "admin" },
        packageId: "p1",
      }),
    ).rejects.toMatchObject({ code: "self_approve" });
  });

  it("client cannot approve", async () => {
    await expect(
      assertCanApprovePackage({
        actor: { id: "c1", name: "Client", email: "c@x", role: "client" },
        packageId: "p1",
      }),
    ).rejects.toMatchObject({ code: "client_forbidden" });
  });

  it("brand host blocked in requireAdsPublishApi (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/access.ts"),
      "utf8",
    );
    expect(src).toMatch(/kind === "tenant"/);
    expect(src).toMatch(/Marka host/);
    expect(src).toMatch(/role === "client"/);
  });

  it("edit after approve resets to draft (source)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/panel/ads-publish/packages.ts"),
      "utf8",
    );
    expect(src).toMatch(/pending.*approved/);
    expect(src).toMatch(/status: nextStatus/);
    expect(src).toMatch(/assertCanApprovePackage/);
  });
});
