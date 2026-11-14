import { prisma } from "@/lib/db";

export type MetaAdRow = {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  status: string;
  effectiveStatus: string;
  creativeId: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  permalinkUrl: string | null;
  linkUrl: string | null;
  urlTags: string | null;
};

export type MetaAdsAdsetNode = {
  adsetId: string;
  adsetName: string;
  status: string;
  effectiveStatus: string;
  budgetKind: "daily" | "lifetime" | "none";
  ads: MetaAdRow[];
};

export type MetaAdsCampaignNode = {
  campaignId: string;
  campaignName: string;
  status: string;
  effectiveStatus: string;
  /** campaign | adset | none */
  budgetLevel: string;
  budgetKind: "daily" | "lifetime" | "none";
  adsets: MetaAdsAdsetNode[];
};

function asBudgetKind(raw: string | null | undefined): "daily" | "lifetime" | "none" {
  if (raw === "daily" || raw === "lifetime") return raw;
  return "none";
}

/** Sync’ten gelen MetaAd + MetaCampaign/MetaAdSet bütçe bağlamı. */
export async function loadMetaAdsTree(
  tenantId: string,
): Promise<{ tree: MetaAdsCampaignNode[]; syncedAt: string | null }> {
  // META_AD_QUERY: ALL — yayın paneli durdurulmuşları yeniden başlatmak için gösterir.
  const [rows, campaigns, adsets] = await Promise.all([
    prisma.metaAd.findMany({
      where: {
        tenantId,
        effectiveStatus: { notIn: ["DELETED", "ARCHIVED"] },
      },
      orderBy: [
        { campaignName: "asc" },
        { adsetName: "asc" },
        { adName: "asc" },
      ],
    }),
    prisma.metaCampaign.findMany({
      where: {
        tenantId,
        effectiveStatus: { notIn: ["DELETED", "ARCHIVED"] },
      },
      select: {
        campaignId: true,
        campaignName: true,
        status: true,
        effectiveStatus: true,
        budgetLevel: true,
        budgetKind: true,
        syncedAt: true,
      },
    }),
    prisma.metaAdSet.findMany({
      where: {
        tenantId,
        effectiveStatus: { notIn: ["DELETED", "ARCHIVED"] },
      },
      select: {
        adsetId: true,
        adsetName: true,
        campaignId: true,
        status: true,
        effectiveStatus: true,
        budgetKind: true,
        syncedAt: true,
      },
    }),
  ]);

  const campMeta = new Map(campaigns.map((c) => [c.campaignId, c]));
  const setMeta = new Map(adsets.map((a) => [a.adsetId, a]));

  let syncedAt: string | null = null;
  const bump = (d: Date) => {
    if (!syncedAt || d > new Date(syncedAt)) syncedAt = d.toISOString();
  };
  for (const c of campaigns) bump(c.syncedAt);
  for (const a of adsets) bump(a.syncedAt);

  const byCampaign = new Map<string, MetaAdsCampaignNode>();

  for (const r of rows) {
    bump(r.syncedAt);
    const campaignId = r.campaignId || "unknown";
    const cm = campMeta.get(campaignId);
    let camp = byCampaign.get(campaignId);
    if (!camp) {
      camp = {
        campaignId,
        campaignName: cm?.campaignName || r.campaignName || campaignId,
        status: cm?.status || "",
        effectiveStatus: cm?.effectiveStatus || "",
        budgetLevel: cm?.budgetLevel || "none",
        budgetKind: asBudgetKind(cm?.budgetKind),
        adsets: [],
      };
      byCampaign.set(campaignId, camp);
    }
    const adsetId = r.adsetId || "unknown";
    const sm = setMeta.get(adsetId);
    let adset = camp.adsets.find((a) => a.adsetId === adsetId);
    if (!adset) {
      adset = {
        adsetId,
        adsetName: sm?.adsetName || r.adsetName || adsetId,
        status: sm?.status || "",
        effectiveStatus: sm?.effectiveStatus || "",
        budgetKind: asBudgetKind(sm?.budgetKind),
        ads: [],
      };
      camp.adsets.push(adset);
    }
    adset.ads.push({
      adId: r.adId,
      adName: r.adName || r.adId,
      adsetId: r.adsetId,
      adsetName: r.adsetName,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      status: r.status,
      effectiveStatus: r.effectiveStatus,
      creativeId: r.creativeId,
      thumbnailUrl: r.thumbnailUrl,
      imageUrl: r.imageUrl,
      permalinkUrl: r.permalinkUrl,
      linkUrl: r.linkUrl,
      urlTags: r.urlTags,
    });
  }

  // Reklamı olmayan ama sync’te olan kampanyalar (yalnızca yapı)
  for (const c of campaigns) {
    if (byCampaign.has(c.campaignId)) continue;
    byCampaign.set(c.campaignId, {
      campaignId: c.campaignId,
      campaignName: c.campaignName || c.campaignId,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      budgetLevel: c.budgetLevel,
      budgetKind: asBudgetKind(c.budgetKind),
      adsets: [],
    });
  }

  return { tree: [...byCampaign.values()], syncedAt };
}

export function effectiveStatusHint(opts: {
  entityStatus: string;
  entityEffective: string;
  parentLabel?: string;
  parentStatus?: string;
}): string | null {
  const st = opts.entityStatus.toUpperCase();
  const eff = opts.entityEffective.toUpperCase();
  if (!eff || eff === st) return null;
  if (eff === "CAMPAIGN_PAUSED") {
    return opts.parentLabel
      ? `${opts.parentLabel} aktif görünüyor, kampanya durdurulmuş`
      : "Kampanya durdurulmuş";
  }
  if (eff === "ADSET_PAUSED") {
    return "Reklam seti durdurulmuş";
  }
  if (st === "ACTIVE" && eff !== "ACTIVE") {
    return `Ayar: ${st}, fiili: ${eff}`;
  }
  return null;
}
