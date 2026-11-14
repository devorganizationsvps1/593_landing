/**
 * (e) Yazma hedefi sahipliği — senkronize Meta kayıtları + tenant metaAccountId.
 * Mock mod / mock tenant / mock ID → ret.
 */
import { prisma } from "@/lib/db";
import { useMockPanelData } from "@/lib/integrations/tokens";
import { MOCK_TENANTS } from "@/lib/panel/mock-data";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";

export class OwnershipError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "mock_mode"
      | "mock_tenant"
      | "mock_id"
      | "account_mismatch"
      | "ad_not_found"
      | "adset_not_found"
      | "campaign_not_found"
      | "foreign_tenant",
  ) {
    super(message);
    this.name = "OwnershipError";
  }
}

function actKey(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d ? `act_${d}` : raw.trim().toLowerCase();
}

const MOCK_ID_RE = /^(mock_|dryrun_|test_|act_mareen|act_demo)/i;

export function looksLikeMockMetaId(id: string | undefined | null): boolean {
  if (!id?.trim()) return false;
  return MOCK_ID_RE.test(id.trim());
}

export function isMockTenantRecord(tenant: {
  id: string;
  slug: string;
  metaAccountId: string;
}): boolean {
  if (tenant.id.startsWith("mock_")) return true;
  if (looksLikeMockMetaId(tenant.metaAccountId)) return true;
  return MOCK_TENANTS.some(
    (m) => m.tenant.id === tenant.id || m.tenant.slug === tenant.slug,
  );
}

export async function assertTargetOwnership(opts: {
  tenantId: string;
  payload: AdChangePayload;
}): Promise<void> {
  if (useMockPanelData()) {
    throw new OwnershipError(
      "Mock veri modunda Meta yazma paketi oluşturulamaz.",
      "mock_mode",
    );
  }

  const tenant = await prisma.tenant.findFirst({
    where: { id: opts.tenantId },
    select: { id: true, slug: true, metaAccountId: true },
  });
  if (!tenant) throw new OwnershipError("Marka bulunamadı", "mock_tenant");

  if (isMockTenantRecord(tenant)) {
    throw new OwnershipError(
      "Mock marka için Meta yazma paketi oluşturulamaz.",
      "mock_tenant",
    );
  }

  const { target } = opts.payload;
  for (const id of [target.adId, target.adsetId, target.campaignId, target.adAccountId]) {
    if (looksLikeMockMetaId(id)) {
      throw new OwnershipError(
        `Mock Meta ID reddedildi: ${id}`,
        "mock_id",
      );
    }
  }

  if (target.adAccountId?.trim()) {
    if (actKey(target.adAccountId) !== actKey(tenant.metaAccountId)) {
      throw new OwnershipError(
        "adAccountId bu markanın metaAccountId’sine ait değil.",
        "account_mismatch",
      );
    }
  } else {
    // Boşsa tenant hesabını zorunlu doldur / yine de hesap eşleşmesi beklenir
    throw new OwnershipError(
      "adAccountId gerekli ve tenant metaAccountId ile eşleşmeli.",
      "account_mismatch",
    );
  }

  if (target.adId) {
    const ad = await prisma.metaAd.findFirst({
      where: { adId: target.adId },
      select: { tenantId: true, adsetId: true, campaignId: true },
    });
    if (!ad) {
      throw new OwnershipError(
        `Reklam senkronize kayıtlarda yok: ${target.adId}`,
        "ad_not_found",
      );
    }
    if (ad.tenantId !== tenant.id) {
      throw new OwnershipError(
        `Reklam başka markaya ait: ${target.adId}`,
        "foreign_tenant",
      );
    }
    if (target.adsetId && ad.adsetId && target.adsetId !== ad.adsetId) {
      throw new OwnershipError(
        `adsetId reklam kaydıyla uyuşmuyor: ${target.adsetId}`,
        "adset_not_found",
      );
    }
  }

  if (target.adsetId) {
    const viaAd = await prisma.metaAd.findFirst({
      where: { tenantId: tenant.id, adsetId: target.adsetId },
      select: { id: true },
    });
    const viaInsight = viaAd
      ? true
      : Boolean(
          await prisma.metaAdsetInsight.findFirst({
            where: { tenantId: tenant.id, adsetId: target.adsetId },
            select: { id: true },
          }),
        );
    if (!viaInsight) {
      throw new OwnershipError(
        `Reklam seti senkronize kayıtlarda yok: ${target.adsetId}`,
        "adset_not_found",
      );
    }
    // Başka tenant’ta aynı adsetId?
    const foreign = await prisma.metaAd.findFirst({
      where: { adsetId: target.adsetId, tenantId: { not: tenant.id } },
      select: { tenantId: true },
    });
    if (foreign && !viaAd) {
      // insight-only on this tenant is OK; if only foreign MetaAd exists without local → already failed
    }
  }

  if (target.campaignId) {
    const viaAd = await prisma.metaAd.findFirst({
      where: { tenantId: tenant.id, campaignId: target.campaignId },
      select: { id: true },
    });
    const viaInsight = viaAd
      ? true
      : Boolean(
          await prisma.metaInsight.findFirst({
            where: { tenantId: tenant.id, campaignId: target.campaignId },
            select: { id: true },
          }),
        );
    if (!viaInsight) {
      throw new OwnershipError(
        `Kampanya senkronize kayıtlarda yok: ${target.campaignId}`,
        "campaign_not_found",
      );
    }
  }
}
