/**
 * (d) Paket edit / approve yetkisi — API tarafı (yalnızca admin/staff host).
 * - edit: admin ve team — tüm markalar (Membership şartı yok; marka paneli değil)
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
  _tenantId: string,
): Promise<void> {
  if (actor.role === "client") {
    throw new AuthzError("Müşteri rolü paket düzenleyemez", "client_forbidden");
  }
  if (actor.role === "admin" || actor.role === "team") return;
  throw new AuthzError("Bu API yalnızca ajans personeline açık", "client_forbidden");
}

export async function assertCanApprovePackage(opts: {
  actor: AdsPublishActor;
  packageId: string;
}): Promise<void> {
  if (opts.actor.role === "client") {
    throw new AuthzError("Müşteri rolü onaylayamaz", "client_forbidden");
  }
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
