/**
 * Onay önizlemesi — sunucu kaynağı.
 * Onay, bu özetin fingerprint’i olmadan reddedilir.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import { packageBudgetToMetaMinor } from "@/lib/panel/ads-publish/budget-units";
import { stableStringify } from "@/lib/panel/ads-publish/write-kinds";

export type ApprovalPreviewChange = {
  field: string;
  label: string;
  current: unknown;
  proposed: unknown;
  budget?: {
    currentMajor: number | null;
    proposedMajor: number | null;
    currentMinor: number | null;
    proposedMinor: number | null;
  };
};

export type ApprovalPreview = {
  packageId: string;
  version: number;
  versionId: string;
  title: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  target: {
    campaignId: string | null;
    campaignName: string | null;
    adsetId: string | null;
    adsetName: string | null;
    adId: string | null;
    adName: string | null;
    adAccountId: string;
  };
  impact: {
    adsetCount: number;
    adCount: number;
  };
  changes: ApprovalPreviewChange[];
  /** İstemcinin approve’da geri göndermesi gereken özet imza. */
  fingerprint: string;
};

function majorFromMinor(minor: number | null): number | null {
  if (minor == null) return null;
  return Math.round(minor) / 100;
}

function fingerprintOf(preview: Omit<ApprovalPreview, "fingerprint">): string {
  const body = {
    packageId: preview.packageId,
    version: preview.version,
    versionId: preview.versionId,
    target: preview.target,
    impact: preview.impact,
    changes: preview.changes,
  };
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export async function buildApprovalPreview(
  packageId: string,
): Promise<ApprovalPreview | null> {
  const pack = await prisma.adChangePackage.findFirst({
    where: { id: packageId },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!pack) return null;

  const version = await prisma.adChangePackageVersion.findFirst({
    where: { packageId: pack.id, version: pack.currentVersion },
  });
  if (!version) return null;

  const payload = (version.payload ?? {}) as AdChangePayload;
  const target = payload.target ?? {
    tenantId: pack.tenantId,
    platform: pack.platform,
    adAccountId: "",
  };

  const campaignId = (target.campaignId || "").trim() || null;
  const adsetId = (target.adsetId || "").trim() || null;
  const adId = (target.adId || "").trim() || null;

  const [campaign, adset, ad] = await Promise.all([
    campaignId
      ? prisma.metaCampaign.findFirst({
          where: { tenantId: pack.tenantId, campaignId },
          select: { campaignName: true },
        })
      : null,
    adsetId
      ? prisma.metaAdSet.findFirst({
          where: { tenantId: pack.tenantId, adsetId },
          select: { adsetName: true, campaignName: true },
        })
      : null,
    adId
      ? prisma.metaAd.findFirst({
          where: { tenantId: pack.tenantId, adId },
          select: {
            adName: true,
            adsetName: true,
            campaignName: true,
            campaignId: true,
            adsetId: true,
          },
        })
      : null,
  ]);

  const resolvedCampaignId = campaignId || ad?.campaignId || null;
  const resolvedAdsetId = adsetId || ad?.adsetId || null;

  let adsetCount = 0;
  let adCount = 0;
  if (resolvedCampaignId) {
    const [sets, ads] = await Promise.all([
      prisma.metaAdSet.count({
        where: {
          tenantId: pack.tenantId,
          campaignId: resolvedCampaignId,
          effectiveStatus: { notIn: ["DELETED", "ARCHIVED"] },
        },
      }),
      prisma.metaAd.count({
        where: {
          tenantId: pack.tenantId,
          campaignId: resolvedCampaignId,
          effectiveStatus: { notIn: ["DELETED", "ARCHIVED"] },
        },
      }),
    ]);
    adsetCount = sets;
    adCount = ads;
  } else if (resolvedAdsetId) {
    adsetCount = 1;
    adCount = await prisma.metaAd.count({
      where: {
        tenantId: pack.tenantId,
        adsetId: resolvedAdsetId,
        effectiveStatus: { notIn: ["DELETED", "ARCHIVED"] },
      },
    });
  } else if (adId) {
    adsetCount = resolvedAdsetId ? 1 : 0;
    adCount = 1;
  }

  const changes: ApprovalPreviewChange[] = (payload.changes ?? []).map((c) => {
    const row: ApprovalPreviewChange = {
      field: c.field,
      label: c.label,
      current: c.current,
      proposed: c.proposed,
    };
    if (
      c.field === "adset.daily_budget" ||
      c.field === "campaign.daily_budget"
    ) {
      const currentMinor = packageBudgetToMetaMinor(c.current);
      const proposedMinor = packageBudgetToMetaMinor(c.proposed);
      row.budget = {
        currentMinor,
        proposedMinor,
        currentMajor: majorFromMinor(currentMinor),
        proposedMajor: majorFromMinor(proposedMinor),
      };
    }
    return row;
  });

  const base: Omit<ApprovalPreview, "fingerprint"> = {
    packageId: pack.id,
    version: pack.currentVersion,
    versionId: version.id,
    title: pack.title,
    tenantId: pack.tenantId,
    tenantName: pack.tenant.name,
    tenantSlug: pack.tenant.slug,
    target: {
      campaignId: resolvedCampaignId,
      campaignName:
        campaign?.campaignName ||
        adset?.campaignName ||
        ad?.campaignName ||
        null,
      adsetId: resolvedAdsetId,
      adsetName: adset?.adsetName || ad?.adsetName || null,
      adId,
      adName: ad?.adName || null,
      adAccountId: target.adAccountId || "",
    },
    impact: { adsetCount, adCount },
    changes,
  };

  return { ...base, fingerprint: fingerprintOf(base) };
}

export function previewSummaryForStorage(preview: ApprovalPreview) {
  return {
    fingerprint: preview.fingerprint,
    version: preview.version,
    versionId: preview.versionId,
    title: preview.title,
    target: preview.target,
    impact: preview.impact,
    changes: preview.changes,
  };
}
