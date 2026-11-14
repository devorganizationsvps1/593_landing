/**
 * (e) Yazma hedefi sahipliği — MetaCampaign / MetaAdSet / MetaAd + tenant metaAccountId.
 * Mock mod / mock tenant / mock ID → ret.
 * Hacim penceresi dışında kalan durdurulmuş varlıklar için açık mesaj.
 */
import { prisma } from "@/lib/db";
import { useMockPanelData } from "@/lib/integrations/tokens";
import { MOCK_TENANTS } from "@/lib/panel/mock-data";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import { metaStructureInactiveMaxAgeDays } from "@/lib/integrations/meta/structure-config";

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
      | "foreign_tenant"
      | "empty_campaign_id"
      | "outside_sync_window",
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

function outsideWindowMessage(kind: string, id: string): string {
  const days = metaStructureInactiveMaxAgeDays();
  return (
    `${kind} senkronize kayıtlarda yok: ${id}. ` +
    `Muhtemel neden: ${days} günden eski durdurulmuş varlık (hacim penceresi dışı); ` +
    `Ads Manager’dan güncelleyin veya META_STRUCTURE_INACTIVE_MAX_AGE_DAYS değerini artırın.`
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
  for (const id of [
    target.adId,
    target.adsetId,
    target.campaignId,
    target.adAccountId,
  ]) {
    if (looksLikeMockMetaId(id)) {
      throw new OwnershipError(`Mock Meta ID reddedildi: ${id}`, "mock_id");
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
    throw new OwnershipError(
      "adAccountId gerekli ve tenant metaAccountId ile eşleşmeli.",
      "account_mismatch",
    );
  }

  const campaignId = (target.campaignId || "").trim();
  if (!campaignId || campaignId === "unknown") {
    throw new OwnershipError(
      "campaignId boş veya unknown — hedef yazılamaz.",
      "empty_campaign_id",
    );
  }

  // META_AD_QUERY: ALL — sahiplik durdurulmuş satırları da kabul eder.
  if (target.adId) {
    const ad = await prisma.metaAd.findFirst({
      where: { adId: target.adId },
      select: {
        tenantId: true,
        adsetId: true,
        campaignId: true,
        effectiveStatus: true,
      },
    });
    if (!ad) {
      throw new OwnershipError(
        outsideWindowMessage("Reklam", target.adId),
        "outside_sync_window",
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
    const set = await prisma.metaAdSet.findFirst({
      where: { tenantId: tenant.id, adsetId: target.adsetId },
      select: {
        id: true,
        campaignId: true,
        metaAccountId: true,
        effectiveStatus: true,
      },
    });
    if (!set) {
      // Geriye dönük: MetaAd üzerinden
      const viaAd = await prisma.metaAd.findFirst({
        where: { tenantId: tenant.id, adsetId: target.adsetId },
        select: { id: true },
      });
      if (!viaAd) {
        throw new OwnershipError(
          outsideWindowMessage("Reklam seti", target.adsetId),
          "outside_sync_window",
        );
      }
    } else if (
      set.metaAccountId &&
      actKey(set.metaAccountId) !== actKey(tenant.metaAccountId)
    ) {
      throw new OwnershipError(
        `Reklam seti başka hesaba ait: ${target.adsetId}`,
        "account_mismatch",
      );
    }
  }

  {
    const camp = await prisma.metaCampaign.findFirst({
      where: { tenantId: tenant.id, campaignId },
      select: { id: true, metaAccountId: true },
    });
    if (!camp) {
      const viaAd = await prisma.metaAd.findFirst({
        where: { tenantId: tenant.id, campaignId },
        select: { id: true },
      });
      if (!viaAd) {
        throw new OwnershipError(
          outsideWindowMessage("Kampanya", campaignId),
          "outside_sync_window",
        );
      }
    } else if (
      camp.metaAccountId &&
      actKey(camp.metaAccountId) !== actKey(tenant.metaAccountId)
    ) {
      throw new OwnershipError(
        `Kampanya başka hesaba ait: ${campaignId}`,
        "account_mismatch",
      );
    }
  }
}
