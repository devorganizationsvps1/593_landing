/**
 * Salt okunur — marka bazında aktif reklam kreatif türleri + harcama payı.
 * V2 prod sonrası çalıştırılır; K2 önceliklerini belirlemek için.
 *
 *   DATABASE_URL=… META_SYSTEM_USER_TOKEN=… npx tsx scripts/report-meta-creative-shapes.ts [tenantSlug]
 *
 * Token yoksa yalnızca DB’deki MetaAd satırlarını listeler (şekil: unknown/cached yok).
 */
import { prisma } from "../src/lib/db";
import { fetchLiveCreativeById } from "../src/lib/integrations/meta/write";
import {
  classifyCreativeShape,
  CREATIVE_SHAPE_LABEL,
  type CreativeShape,
} from "../src/lib/panel/ads-publish/creative-shape";

type Agg = {
  shape: CreativeShape;
  ads: number;
  spend: number;
};

async function main() {
  const slugFilter = process.argv[2]?.trim();
  const tenants = await prisma.tenant.findMany({
    where: {
      ...(slugFilter ? { slug: slugFilter } : {}),
      metaAccountId: { not: "" },
    },
    select: { id: true, slug: true, name: true, metaAccountId: true },
    orderBy: { slug: "asc" },
  });

  const hasToken = Boolean(process.env.META_SYSTEM_USER_TOKEN?.trim());
  console.log(
    JSON.stringify({
      tenants: tenants.length,
      liveCreativeFetch: hasToken,
      note: hasToken
        ? "ACTIVE reklam kreatifleri Graph’tan sınıflandırılır"
        : "Token yok — şekil bilinemez; yalnızca ACTIVE reklam sayıları",
    }),
  );

  for (const t of tenants) {
    const ads = await prisma.metaAd.findMany({
      where: {
        tenantId: t.id,
        effectiveStatus: "ACTIVE",
      },
      select: { adId: true, creativeId: true },
    });

    const spendRows = await prisma.metaAdInsight.groupBy({
      by: ["adId"],
      where: { tenantId: t.id },
      _sum: { spend: true },
    });
    const spendByAd = new Map(
      spendRows.map((r) => [r.adId, Number(r._sum.spend ?? 0)]),
    );

    const byShape = new Map<CreativeShape, Agg>();
    const bump = (shape: CreativeShape, adId: string) => {
      const cur = byShape.get(shape) ?? { shape, ads: 0, spend: 0 };
      cur.ads += 1;
      cur.spend += spendByAd.get(adId) ?? 0;
      byShape.set(shape, cur);
    };

    for (const ad of ads) {
      if (!hasToken || !ad.creativeId) {
        bump("unknown", ad.adId);
        continue;
      }
      try {
        const c = await fetchLiveCreativeById(ad.creativeId);
        bump(classifyCreativeShape(c), ad.adId);
      } catch {
        bump("unknown", ad.adId);
      }
    }

    const totalSpend = [...byShape.values()].reduce((s, a) => s + a.spend, 0);
    const rows = [...byShape.values()]
      .sort((a, b) => b.ads - a.ads)
      .map((a) => ({
        shape: a.shape,
        label: CREATIVE_SHAPE_LABEL[a.shape],
        ads: a.ads,
        spend: Math.round(a.spend * 100) / 100,
        spendShare:
          totalSpend > 0
            ? Math.round((a.spend / totalSpend) * 1000) / 10
            : 0,
      }));

    console.log(
      JSON.stringify({
        tenant: t.slug,
        name: t.name,
        activeAds: ads.length,
        totalSpend: Math.round(totalSpend * 100) / 100,
        byShape: rows,
      }),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
