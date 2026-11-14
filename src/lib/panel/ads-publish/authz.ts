/**
 * (d) Paket edit / approve yetkisi — API tarafı.
 * - edit: admin tüm markalar; team yalnızca Membership
 * - approve: admin veya ADS_PUBLISH allowlist; oluşturan / son düzenleyen self-approve yok
 * - client ve brand host: access.requireAdsPublishApi
 */
import { prisma } from "@/lib/db";
import { canAccessAdsPublish } from "@/lib/panel/ads-publish/access-policy";
import type { AdsPublishActor } from "@/lib/panel/ads-publish/access";

export class AuthzError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_member"
      | "self_approve"
      | "not_approver"
      | "client_forbidden"
      | "brand_host_forbidden",
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

export async function assertCanEditTenant(
  actor: AdsPublishActor,
  tenantId: string,
): Promise<void> {
  if (actor.role === "client") {
    throw new AuthzError("Müşteri rolü paket düzenleyemez", "client_forbidden");
  }
  if (actor.role === "admin") return;
  const m = await prisma.membership.findFirst({
    where: { userId: actor.id, tenantId },
    select: { id: true },
  });
  if (!m) {
    throw new AuthzError("Bu markanın üyesi değilsiniz", "not_member");
  }
}

export async function assertCanApprovePackage(opts: {
  actor: AdsPublishActor;
  packageId: string;
}): Promise<void> {
  if (opts.actor.role === "client") {
    throw new AuthzError("Müşteri rolü onaylayamaz", "client_forbidden");
  }
  // admin veya mevcut allowlist (Hakan/Numan/Muhammet + admin flag)
  if (opts.actor.role !== "admin" && !canAccessAdsPublish(opts.actor)) {
    throw new AuthzError("Onay yetkisi yok (allowlist)", "not_approver");
  }

  const pack = await prisma.adChangePackage.findFirst({
    where: { id: opts.packageId },
    select: {
      createdById: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { createdById: true },
      },
    },
  });
  if (!pack) throw new Error("Paket bulunamadı");

  const lastEditorId = pack.versions[0]?.createdById ?? null;
  if (pack.createdById && pack.createdById === opts.actor.id) {
    throw new AuthzError(
      "Kendi oluşturduğunuz paketi onaylayamazsınız",
      "self_approve",
    );
  }
  if (lastEditorId && lastEditorId === opts.actor.id) {
    throw new AuthzError(
      "Son düzenlediğiniz paketi onaylayamazsınız",
      "self_approve",
    );
  }
}
