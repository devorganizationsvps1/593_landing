import { prisma } from "@/lib/db";
import { ymdToUtcDate } from "@/lib/date/tr";
import { isIntegrationDisabled } from "@/lib/panel/integrations";
import { resolveAdsCustomerId } from "@/lib/panel/google-ads-customer-map";

export type GoogleAnalyzeCampaign = {
  campaignId: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  convValue: number;
  cpa: number | null;
  roas: number | null;
};

export type GoogleAnalyzeBrand = {
  id: string;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  adsCustomerId: string | null;
  conversionColumn: string;
  campaigns: GoogleAnalyzeCampaign[];
  cost: number;
  conversions: number;
};

export type GoogleAnalyzeSnapshot = {
  startDate: string;
  endDate: string;
  conversionColumn: string;
  brands: GoogleAnalyzeBrand[];
};

function n(v: { toString(): string } | number | null | undefined): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(x) ? x : 0;
}

export async function loadGoogleAdsAnalyze(opts: {
  startDate: string;
  endDate: string;
}): Promise<GoogleAnalyzeSnapshot> {
  const tenants = await prisma.tenant.findMany({
    where: { visible: true },
    select: {
      id: true,
      slug: true,
      name: true,
      currency: true,
      type: true,
      disabledIntegrations: true,
      mapping: { select: { adsCustomerId: true, adsTimezone: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const eligible = tenants.filter((t) => !isIntegrationDisabled(t, "google_ads"));
  const ids = eligible.map((t) => t.id);
  const rows =
    ids.length === 0
      ? []
      : await prisma.googleAdsMetric.findMany({
          where: {
            tenantId: { in: ids },
            date: {
              gte: ymdToUtcDate(opts.startDate),
              lte: ymdToUtcDate(opts.endDate),
            },
          },
          select: {
            tenantId: true,
            campaignId: true,
            campaignName: true,
            cost: true,
            impressions: true,
            clicks: true,
            conversions: true,
            convValue: true,
          },
        });

  const byTenant = new Map<string, Map<string, GoogleAnalyzeCampaign>>();
  for (const row of rows) {
    let campMap = byTenant.get(row.tenantId);
    if (!campMap) {
      campMap = new Map();
      byTenant.set(row.tenantId, campMap);
    }
    const id = row.campaignId || row.campaignName || "unknown";
    const prev = campMap.get(id) ?? {
      campaignId: id,
      campaignName: row.campaignName || id,
      cost: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      convValue: 0,
      cpa: null,
      roas: null,
    };
    prev.cost += n(row.cost);
    prev.impressions += row.impressions;
    prev.clicks += row.clicks;
    prev.conversions += n(row.conversions);
    prev.convValue += n(row.convValue);
    campMap.set(id, prev);
  }

  const brands: GoogleAnalyzeBrand[] = eligible.map((t) => {
    const conversionColumn =
      t.type === "ecommerce" ? "conversions + convValue (ROAS)" : "conversions (CPA)";
    const campaigns = [...(byTenant.get(t.id)?.values() ?? [])]
      .map((c) => ({
        ...c,
        cpa: c.conversions > 0 ? c.cost / c.conversions : null,
        roas: c.cost > 0 ? c.convValue / c.cost : null,
      }))
      .sort((a, b) => b.cost - a.cost);
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      currency: t.currency || "TRY",
      timezone: t.mapping?.adsTimezone || "Europe/Istanbul",
      adsCustomerId: resolveAdsCustomerId(t),
      conversionColumn,
      campaigns,
      cost: campaigns.reduce((s, c) => s + c.cost, 0),
      conversions: campaigns.reduce((s, c) => s + c.conversions, 0),
    };
  });

  return {
    startDate: opts.startDate,
    endDate: opts.endDate,
    conversionColumn: "Kampanya conversions / convValue (hesap saat dilimi)",
    brands: brands.filter((b) => b.campaigns.length > 0 || b.adsCustomerId),
  };
}

export async function listMetaPublishBrands() {
  const tenants = await prisma.tenant.findMany({
    where: { visible: true },
    select: {
      id: true,
      slug: true,
      name: true,
      metaAccountId: true,
      disabledIntegrations: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return tenants
    .filter((t) => !isIntegrationDisabled(t, "meta"))
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      metaAccountId: t.metaAccountId,
    }));
}
