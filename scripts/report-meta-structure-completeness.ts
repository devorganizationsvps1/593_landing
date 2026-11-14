/**
 * (a) MetaCampaign / MetaAdSet / MetaAd eksiksizlik özeti.
 * Kullanım: npx tsx scripts/report-meta-structure-completeness.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const LIVE = { notIn: ["DELETED", "ARCHIVED"] } as const;

async function main() {
  const p = new PrismaClient();
  try {
    const [campaigns, adsets, ads] = await Promise.all([
      p.metaCampaign.count(),
      p.metaAdSet.count(),
      p.metaAd.count(),
    ]);

    const campLive = await p.metaCampaign.findMany({
      where: { effectiveStatus: LIVE },
      select: {
        campaignId: true,
        campaignName: true,
        status: true,
        effectiveStatus: true,
        metaAccountId: true,
        budgetLevel: true,
        budgetKind: true,
      },
    });
    const setLive = await p.metaAdSet.findMany({
      where: { effectiveStatus: LIVE },
      select: {
        adsetId: true,
        campaignId: true,
        campaignName: true,
        status: true,
        budgetKind: true,
      },
    });
    const adLive = await p.metaAd.findMany({
      where: { effectiveStatus: LIVE },
      select: {
        adId: true,
        campaignId: true,
        campaignName: true,
        adsetId: true,
        adsetName: true,
        status: true,
        effectiveStatus: true,
        tenantId: true,
      },
    });

    const campIds = new Set(
      (
        await p.metaCampaign.findMany({
          select: { tenantId: true, campaignId: true },
        })
      ).map((r) => `${r.tenantId}|${r.campaignId}`),
    );
    const setIds = new Set(
      (
        await p.metaAdSet.findMany({
          select: { tenantId: true, adsetId: true },
        })
      ).map((r) => `${r.tenantId}|${r.adsetId}`),
    );

    const report = {
      totals: { MetaCampaign: campaigns, MetaAdSet: adsets, MetaAd: ads },
      campaigns: {
        live: campLive.length,
        no_id: campLive.filter((c) => !c.campaignId).length,
        no_name: campLive.filter((c) => !c.campaignName).length,
        no_status: campLive.filter((c) => !c.status).length,
        no_effective: campLive.filter((c) => !c.effectiveStatus).length,
        no_account: campLive.filter((c) => !c.metaAccountId).length,
        cbo: campLive.filter((c) => c.budgetLevel === "campaign").length,
        abo: campLive.filter((c) => c.budgetLevel === "adset").length,
        lifetime_budget: campLive.filter((c) => c.budgetKind === "lifetime")
          .length,
        daily_budget: campLive.filter((c) => c.budgetKind === "daily").length,
      },
      adsets: {
        live: setLive.length,
        no_id: setLive.filter((s) => !s.adsetId).length,
        no_campaign_id: setLive.filter((s) => !s.campaignId).length,
        no_campaign_name: setLive.filter((s) => !s.campaignName).length,
        no_status: setLive.filter((s) => !s.status).length,
        lifetime_budget: setLive.filter((s) => s.budgetKind === "lifetime")
          .length,
        daily_budget: setLive.filter((s) => s.budgetKind === "daily").length,
      },
      ads: {
        live: adLive.length,
        no_campaign_id: adLive.filter((a) => !a.campaignId).length,
        no_campaign_name: adLive.filter((a) => !a.campaignName).length,
        no_adset_id: adLive.filter((a) => !a.adsetId).length,
        no_adset_name: adLive.filter((a) => !a.adsetName).length,
        no_status: adLive.filter((a) => !a.status).length,
        status_paused: adLive.filter((a) => a.status.toUpperCase() === "PAUSED")
          .length,
        eff_paused: adLive.filter(
          (a) => a.effectiveStatus.toUpperCase() === "PAUSED",
        ).length,
        eff_active: adLive.filter(
          (a) => a.effectiveStatus.toUpperCase() === "ACTIVE",
        ).length,
        ads_missing_campaign_row: adLive.filter(
          (a) =>
            a.campaignId && !campIds.has(`${a.tenantId}|${a.campaignId}`),
        ).length,
        ads_missing_adset_row: adLive.filter(
          (a) => a.adsetId && !setIds.has(`${a.tenantId}|${a.adsetId}`),
        ).length,
      },
    };

    console.log(JSON.stringify(report, null, 2));

    const gaps: string[] = [];
    if (report.campaigns.no_id) gaps.push(`campaigns.no_id=${report.campaigns.no_id}`);
    if (report.adsets.no_campaign_id)
      gaps.push(`adsets.no_campaign_id=${report.adsets.no_campaign_id}`);
    if (report.ads.no_campaign_id)
      gaps.push(`ads.no_campaign_id=${report.ads.no_campaign_id}`);
    if (report.ads.ads_missing_campaign_row)
      gaps.push(
        `ads_missing_campaign_row=${report.ads.ads_missing_campaign_row}`,
      );
    if (report.ads.ads_missing_adset_row)
      gaps.push(`ads_missing_adset_row=${report.ads.ads_missing_adset_row}`);

    if (campaigns + adsets + ads === 0) {
      console.log(
        "\nNOT: Tablolar boş — henüz Meta yapı sync çalışmamış (veya local’de veri yok).",
      );
    } else if (gaps.length) {
      console.log("\nEKSİKLER:", gaps.join(", "));
      process.exitCode = 2;
    } else {
      console.log("\nEksiksizlik: kampanya/set bağlantıları dolu görünüyor.");
    }
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
