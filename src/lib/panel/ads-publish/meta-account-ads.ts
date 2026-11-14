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

export type MetaAdsCampaignNode = {
  campaignId: string;
  campaignName: string;
  adsets: Array<{
    adsetId: string;
    adsetName: string;
    ads: MetaAdRow[];
  }>;
};

/** Sync’ten gelen MetaAd snapshot’ını kampanya → set → reklam ağacına çevirir. */
export async function loadMetaAdsTree(
  tenantId: string,
): Promise<{ tree: MetaAdsCampaignNode[]; syncedAt: string | null }> {
  const rows = await prisma.metaAd.findMany({
    where: { tenantId },
    orderBy: [{ campaignName: "asc" }, { adsetName: "asc" }, { adName: "asc" }],
  });

  let syncedAt: string | null = null;
  const byCampaign = new Map<string, MetaAdsCampaignNode>();

  for (const r of rows) {
    if (!syncedAt || r.syncedAt > new Date(syncedAt)) {
      syncedAt = r.syncedAt.toISOString();
    }
    const campaignId = r.campaignId || "unknown";
    let camp = byCampaign.get(campaignId);
    if (!camp) {
      camp = {
        campaignId,
        campaignName: r.campaignName || campaignId,
        adsets: [],
      };
      byCampaign.set(campaignId, camp);
    }
    const adsetId = r.adsetId || "unknown";
    let adset = camp.adsets.find((a) => a.adsetId === adsetId);
    if (!adset) {
      adset = {
        adsetId,
        adsetName: r.adsetName || adsetId,
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

  return { tree: [...byCampaign.values()], syncedAt };
}
