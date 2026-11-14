/**
 * Onay önizlemesi — sunucu kaynağı.
 * Mevcut değerler Meta’dan taze okunur; okunamazsa onay engellenir.
 * Para birimi: Meta hesap (metaCurrency); yoksa Tenant.currency.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AdChangePayload } from "@/lib/panel/ads-publish/types";
import {
  packageBudgetToMetaMinor,
  parseMetaBudgetMinor,
} from "@/lib/panel/ads-publish/budget-units";
import { stableStringify } from "@/lib/panel/ads-publish/write-kinds";
import {
  fetchLiveAdSnapshot,
  fetchLiveAdsetSnapshot,
  fetchLiveCampaignSnapshot,
} from "@/lib/integrations/meta/write";
import {
  currenciesMismatch,
  currencyMismatchMessage,
  resolveBudgetDisplayCurrency,
} from "@/lib/panel/ads-publish/currency";

export type ApprovalPreviewChange = {
  field: string;
  label: string;
  current: unknown;
  proposed: unknown;
  /** current Meta canlı okumadan mı? */
  currentFromLive: boolean;
  budget?: {
    currentMajor: number | null;
    proposedMajor: number | null;
    currentMinor: number | null;
    proposedMinor: number | null;
    currency: string;
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
  currency: string;
  tenantCurrency: string;
  metaCurrency: string;
  currencyMismatch: boolean;
  currencyMismatchMessage: string | null;
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
  liveReadOk: boolean;
  liveReadError: string | null;
  lastSyncedAt: string | null;
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
    currency: preview.currency,
    tenantCurrency: preview.tenantCurrency,
    metaCurrency: preview.metaCurrency,
    currencyMismatch: preview.currencyMismatch,
    target: preview.target,
    impact: preview.impact,
    changes: preview.changes,
    liveReadOk: preview.liveReadOk,
  };
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export async function buildApprovalPreview(
  packageId: string,
): Promise<ApprovalPreview | null> {
  const pack = await prisma.adChangePackage.findFirst({
    where: { id: packageId },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          metaCurrency: true,
        },
      },
    },
  });
  if (!pack) return null;

  const version = await prisma.adChangePackageVersion.findFirst({
    where: { packageId: pack.id, version: pack.currentVersion },
  });
  if (!version) return null;

  const tenantCurrency = (pack.tenant.currency || "TRY").toUpperCase();
  const metaCurrency = (pack.tenant.metaCurrency || "").toUpperCase();
  const currency = resolveBudgetDisplayCurrency({
    tenantCurrency,
    metaCurrency,
  });
  const mismatch = currenciesMismatch(tenantCurrency, metaCurrency);
  const payload = (version.payload ?? {}) as AdChangePayload;
  const target = payload.target ?? {
    tenantId: pack.tenantId,
    platform: pack.platform,
    adAccountId: "",
  };

  const campaignId = (target.campaignId || "").trim() || null;
  const adsetId = (target.adsetId || "").trim() || null;
  const adId = (target.adId || "").trim() || null;

  // META_AD_QUERY: ALL — önizleme etki sayıları / isimler için.
  const [campaign, adset, ad, lastSync] = await Promise.all([
    campaignId
      ? prisma.metaCampaign.findFirst({
          where: { tenantId: pack.tenantId, campaignId },
          select: { campaignName: true, syncedAt: true },
        })
      : null,
    adsetId
      ? prisma.metaAdSet.findFirst({
          where: { tenantId: pack.tenantId, adsetId },
          select: { adsetName: true, campaignName: true, syncedAt: true },
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
            syncedAt: true,
          },
        })
      : null,
    prisma.metaAd.findFirst({
      where: { tenantId: pack.tenantId },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
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

  const lastSyncedAt = (
    ad?.syncedAt ||
    adset?.syncedAt ||
    campaign?.syncedAt ||
    lastSync?.syncedAt ||
    null
  )?.toISOString() ?? null;

  let liveReadOk = true;
  let liveReadError: string | null = null;
  let liveAd: Awaited<ReturnType<typeof fetchLiveAdSnapshot>> | null = null;
  let liveAdset: Awaited<ReturnType<typeof fetchLiveAdsetSnapshot>> | null =
    null;
  let liveCampaign: Awaited<
    ReturnType<typeof fetchLiveCampaignSnapshot>
  > | null = null;

  const needsAd = (payload.changes ?? []).some((c) => c.field === "ad.status");
  const needsAdset = (payload.changes ?? []).some(
    (c) => c.field === "adset.status" || c.field === "adset.daily_budget",
  );
  const needsCampaign = (payload.changes ?? []).some(
    (c) =>
      c.field === "campaign.status" || c.field === "campaign.daily_budget",
  );

  try {
    if (needsAd && adId) {
      liveAd = await fetchLiveAdSnapshot(adId);
    }
    if (needsAdset && resolvedAdsetId) {
      liveAdset = await fetchLiveAdsetSnapshot(resolvedAdsetId);
    }
    if (needsCampaign && resolvedCampaignId) {
      liveCampaign = await fetchLiveCampaignSnapshot(resolvedCampaignId);
    }
  } catch (err) {
    liveReadOk = false;
    liveReadError = err instanceof Error ? err.message : String(err);
  }

  if ((needsAd || needsAdset || needsCampaign) && !liveReadOk) {
    // already set
  } else if (needsAd && !liveAd) {
    liveReadOk = false;
    liveReadError = "Reklam canlı durumu okunamadı";
  } else if (needsAdset && !liveAdset) {
    liveReadOk = false;
    liveReadError = "Reklam seti canlı durumu okunamadı";
  } else if (needsCampaign && !liveCampaign) {
    liveReadOk = false;
    liveReadError = "Kampanya canlı durumu okunamadı";
  }

  const changes: ApprovalPreviewChange[] = (payload.changes ?? []).map((c) => {
    let current = c.current;
    let currentFromLive = false;

    if (c.field === "ad.status" && liveAd) {
      current = liveAd.status;
      currentFromLive = true;
    } else if (c.field === "adset.status" && liveAdset) {
      current = liveAdset.status;
      currentFromLive = true;
    } else if (c.field === "campaign.status" && liveCampaign) {
      current = liveCampaign.status;
      currentFromLive = true;
    } else if (c.field === "adset.daily_budget" && liveAdset) {
      const minor = parseMetaBudgetMinor(liveAdset.daily_budget);
      current = majorFromMinor(minor);
      currentFromLive = true;
    } else if (c.field === "campaign.daily_budget" && liveCampaign) {
      const minor = parseMetaBudgetMinor(liveCampaign.daily_budget);
      current = majorFromMinor(minor);
      currentFromLive = true;
    }

    const row: ApprovalPreviewChange = {
      field: c.field,
      label: c.label,
      current,
      proposed: c.proposed,
      currentFromLive,
    };

    if (
      c.field === "adset.daily_budget" ||
      c.field === "campaign.daily_budget"
    ) {
      const currentMinor =
        typeof current === "number"
          ? packageBudgetToMetaMinor(current)
          : packageBudgetToMetaMinor(c.current);
      const proposedMinor = packageBudgetToMetaMinor(c.proposed);
      row.budget = {
        currentMinor,
        proposedMinor,
        currentMajor: majorFromMinor(currentMinor),
        proposedMajor: majorFromMinor(proposedMinor),
        currency,
      };
    }
    return row;
  });

  if (changes.some((c) => !c.currentFromLive) && (needsAd || needsAdset || needsCampaign)) {
    // Alan canlı okunamadıysa onay engelli
    if (liveReadOk) {
      liveReadOk = false;
      liveReadError =
        liveReadError || "Bazı alanların canlı değeri okunamadı";
    }
  }

  // Bütçe değişimi + para birimi uyuşmazlığı → onaylanamaz
  if (mismatch && changes.some((c) => c.budget)) {
    liveReadOk = false;
    liveReadError = currencyMismatchMessage(tenantCurrency, metaCurrency);
  }

  const base: Omit<ApprovalPreview, "fingerprint"> = {
    packageId: pack.id,
    version: pack.currentVersion,
    versionId: version.id,
    title: pack.title,
    tenantId: pack.tenantId,
    tenantName: pack.tenant.name,
    tenantSlug: pack.tenant.slug,
    currency,
    tenantCurrency,
    metaCurrency,
    currencyMismatch: mismatch,
    currencyMismatchMessage: mismatch
      ? currencyMismatchMessage(tenantCurrency, metaCurrency)
      : null,
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
    liveReadOk,
    liveReadError,
    lastSyncedAt,
  };

  return { ...base, fingerprint: fingerprintOf(base) };
}

export function previewSummaryForStorage(preview: ApprovalPreview) {
  return {
    fingerprint: preview.fingerprint,
    version: preview.version,
    versionId: preview.versionId,
    title: preview.title,
    currency: preview.currency,
    tenantCurrency: preview.tenantCurrency,
    metaCurrency: preview.metaCurrency,
    currencyMismatch: preview.currencyMismatch,
    target: preview.target,
    impact: preview.impact,
    changes: preview.changes,
    liveReadOk: preview.liveReadOk,
    lastSyncedAt: preview.lastSyncedAt,
  };
}

/** Test yardımcısı: USD etiket. */
export function formatBudgetLabel(
  major: number | null,
  currency: string,
): string {
  if (major == null) return "—";
  return `${major} ${currency}/gün`;
}
