/**
 * Aşama 0 — salt okuma envanter + auction insight denemesi.
 *
 * Kullanım (token geldikten sonra):
 *   GOOGLE_CLIENT_ID=... \
 *   GOOGLE_CLIENT_SECRET=... \
 *   GOOGLE_REFRESH_TOKEN=... \          # veya GOOGLE_REFRESH_TOKEN_READONLY
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID=... \
 *   npx tsx scripts/google-ads-phase0-inventory.ts
 *
 * İsteğe bağlı: GOOGLE_ADS_DEVELOPER_TOKEN (gönderilir ama sunucu yok sayabilir)
 * Çıktı: docs/google-ads-analiz-asama-0-inventory.json (+ stderr özet)
 *
 * Mutate / yazma çağrısı yok — yalnızca googleAds:search.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { PrismaClient } from "@prisma/client";
import { GOOGLE_ADS_CUSTOMER_BY_SLUG } from "../src/lib/panel/google-ads-customer-map";

const API_VERSION = "v25";
const ADS_API = `https://googleads.googleapis.com/${API_VERSION}`;
const OUT = resolve("docs/google-ads-analiz-asama-0-inventory.json");

function loadEnvFiles() {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] != null && process.env[m[1]] !== "") continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

function clean(raw: string | undefined): string {
  let v = (raw ?? "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function requireEnv(name: string): string {
  const v = clean(process.env[name]);
  if (!v) throw new Error(`Eksik env: ${name}`);
  return v;
}

async function getAccessToken(): Promise<string> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const refreshToken =
    clean(process.env.GOOGLE_REFRESH_TOKEN_READONLY) ||
    requireEnv("GOOGLE_REFRESH_TOKEN");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Token exchange failed: ${json.error_description || json.error || res.status}`,
    );
  }
  return json.access_token;
}

async function adsSearch(
  customerId: string,
  query: string,
  accessToken: string,
): Promise<unknown[]> {
  const cid = customerId.replace(/-/g, "");
  const loginCustomerId = clean(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(
    /-/g,
    "",
  );
  const developerToken = clean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
  const results: unknown[] = [];
  let pageToken: string | undefined;
  do {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "login-customer-id": loginCustomerId,
    };
    if (developerToken) headers["developer-token"] = developerToken;

    const res = await fetch(
      `${ADS_API}/customers/${cid}/googleAds:search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          pageToken ? { query, pageToken } : { query },
        ),
      },
    );
    const json = (await res.json()) as {
      results?: unknown[];
      nextPageToken?: string;
      error?: {
        message?: string;
        details?: Array<{
          errors?: Array<{
            errorCode?: Record<string, string>;
            message?: string;
          }>;
        }>;
      };
    };
    if (!res.ok) {
      const detail = json.error?.details?.[0]?.errors?.[0];
      const code = detail?.errorCode
        ? Object.entries(detail.errorCode)
            .map(([k, v]) => `${k}:${v}`)
            .join(",")
        : "";
      throw new Error(
        `${json.error?.message || res.status}${code ? ` [${code}]` : ""}${
          detail?.message ? ` — ${detail.message}` : ""
        }`,
      );
    }
    results.push(...(json.results ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return results;
}

type ChannelAgg = {
  campaigns: number;
  enabled: number;
  spend30d: number;
  samples: Array<{ name: string; status: string; spend: number }>;
};

type AccountReport = {
  slug: string;
  name: string | null;
  customerId: string;
  source: "db" | "code_map";
  error: string | null;
  channels: Record<string, ChannelAgg>;
  keywordEstimate: { distinctKeywords: number | null; error: string | null };
  searchTermEstimate: {
    distinctTerms7d: number | null;
    error: string | null;
  };
  auctionInsight: {
    ok: boolean;
    rows?: number;
    sample?: unknown[];
    error?: string;
  } | null;
};

function microsToCurrency(micros: unknown): number {
  const n = typeof micros === "string" ? Number(micros) : Number(micros);
  return Number.isFinite(n) ? n / 1_000_000 : 0;
}

async function main() {
  loadEnvFiles();
  const accessToken = await getAccessToken();
  const prisma = new PrismaClient();

  const dbMaps = await prisma.tenantMapping.findMany({
    where: { adsCustomerId: { not: null } },
    select: {
      adsCustomerId: true,
      tenant: { select: { slug: true, name: true } },
    },
  });

  const accounts = new Map<
    string,
    { slug: string; name: string | null; customerId: string; source: "db" | "code_map" }
  >();

  for (const m of dbMaps) {
    const id = (m.adsCustomerId || "").replace(/-/g, "");
    if (!/^\d{6,}$/.test(id)) continue;
    accounts.set(m.tenant.slug, {
      slug: m.tenant.slug,
      name: m.tenant.name,
      customerId: id,
      source: "db",
    });
  }
  for (const [slug, idRaw] of Object.entries(GOOGLE_ADS_CUSTOMER_BY_SLUG)) {
    if (accounts.has(slug)) continue;
    const id = idRaw.replace(/-/g, "");
    accounts.set(slug, {
      slug,
      name: null,
      customerId: id,
      source: "code_map",
    });
  }

  const accountReports: AccountReport[] = [];
  const agencySpendByChannel: Record<string, number> = {};
  let agencySpendTotal = 0;

  for (const acc of accounts.values()) {
    const entry: AccountReport = {
      slug: acc.slug,
      name: acc.name,
      customerId: acc.customerId,
      source: acc.source,
      error: null,
      channels: {},
      keywordEstimate: { distinctKeywords: null, error: null },
      searchTermEstimate: { distinctTerms7d: null, error: null },
      auctionInsight: null,
    };

    try {
      const rows = (await adsSearch(
        acc.customerId,
        `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.advertising_channel_sub_type,
          metrics.cost_micros
        FROM campaign
        WHERE segments.date DURING LAST_30_DAYS
          AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        `,
        accessToken,
      )) as Array<{
        campaign?: {
          name?: string;
          status?: string;
          advertisingChannelType?: string;
          advertisingChannelSubType?: string;
        };
        metrics?: { costMicros?: string };
      }>;

      for (const r of rows) {
        const ch = r.campaign?.advertisingChannelType || "UNKNOWN";
        const status = r.campaign?.status || "?";
        const spend = microsToCurrency(r.metrics?.costMicros);
        if (!entry.channels[ch]) {
          entry.channels[ch] = {
            campaigns: 0,
            enabled: 0,
            spend30d: 0,
            samples: [],
          };
        }
        entry.channels[ch].campaigns += 1;
        if (status === "ENABLED") entry.channels[ch].enabled += 1;
        entry.channels[ch].spend30d += spend;
        if (entry.channels[ch].samples.length < 3) {
          entry.channels[ch].samples.push({
            name: r.campaign?.name || "(unnamed)",
            status,
            spend: Math.round(spend * 100) / 100,
          });
        }
        agencySpendByChannel[ch] =
          (agencySpendByChannel[ch] || 0) + spend;
        agencySpendTotal += spend;
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }

    try {
      const kw = (await adsSearch(
        acc.customerId,
        `
        SELECT ad_group_criterion.criterion_id
        FROM keyword_view
        WHERE ad_group_criterion.status != 'REMOVED'
          AND campaign.status != 'REMOVED'
        `,
        accessToken,
      )) as unknown[];
      entry.keywordEstimate.distinctKeywords = kw.length;
    } catch (e) {
      entry.keywordEstimate.error =
        e instanceof Error ? e.message : String(e);
    }

    try {
      const st = (await adsSearch(
        acc.customerId,
        `
        SELECT search_term_view.search_term
        FROM search_term_view
        WHERE segments.date DURING LAST_7_DAYS
          AND campaign.status != 'REMOVED'
        `,
        accessToken,
      )) as unknown[];
      // Aynı terim birden fazla satırda gelebilir (kampanya/AG); üst sınır tahmini.
      entry.searchTermEstimate.distinctTerms7d = st.length;
    } catch (e) {
      entry.searchTermEstimate.error =
        e instanceof Error ? e.message : String(e);
    }

    try {
      const ai = await adsSearch(
        acc.customerId,
        `
        SELECT
          campaign.name,
          segments.auction_insight_domain,
          metrics.auction_insight_search_impression_share
        FROM campaign
        WHERE segments.date DURING LAST_7_DAYS
        LIMIT 10
        `,
        accessToken,
      );
      entry.auctionInsight = {
        ok: true,
        rows: ai.length,
        sample: ai.slice(0, 3),
      };
    } catch (e) {
      entry.auctionInsight = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    accountReports.push(entry);
    const chSummary = Object.entries(entry.channels)
      .map(([k, v]) => `${k}:${Math.round(v.spend30d)}`)
      .join("|");
    process.stderr.write(
      `${acc.slug}: ${entry.error ? `ERR ${entry.error.slice(0, 100)}` : chSummary || "no-spend"}; auction=${entry.auctionInsight?.ok}\n`,
    );
  }

  const spendShare = Object.entries(agencySpendByChannel)
    .map(([channel, spend]) => ({
      channel,
      spend30d: Math.round(spend * 100) / 100,
      sharePct:
        agencySpendTotal > 0
          ? Math.round((spend / agencySpendTotal) * 10000) / 100
          : 0,
    }))
    .sort((a, b) => b.spend30d - a.spend30d);

  const keywordsTotal = accountReports.reduce(
    (s, a) => s + (a.keywordEstimate.distinctKeywords || 0),
    0,
  );
  const searchTerms7dTotal = accountReports.reduce(
    (s, a) => s + (a.searchTermEstimate.distinctTerms7d || 0),
    0,
  );
  const campaignsTotal = accountReports.reduce(
    (s, a) =>
      s + Object.values(a.channels).reduce((n, c) => n + c.campaigns, 0),
    0,
  );

  // Satır tahmini (Aşama 0): ölçülen hacim × önerilen lookback.
  const LOOKBACK = {
    campaignDaily: 720,
    keywordDaily: 180,
    searchTermDaily: 90,
    breakdownDaily: 90,
    impressionShareDaily: 90,
    landingPageDaily: 90,
    adDaily: 90,
    changeEventAccumulating: 365, // ilk yıl birikimi varsayımı
  } as const;

  const rowEstimates = {
    assumptions: LOOKBACK,
    notes: [
      "keywordDaily ≈ distinctKeywords × lookback (aktif kelime seti sabit varsayımı; abartılı olabilir).",
      "searchTermDaily ≈ (distinctTerms7d / 7) × 90 — 7g örnekleminden ekstrapolasyon; üst sınır.",
      "GoogleAdsMetric zaten var; ek kolon satır sayısı artırmaz.",
      "change_event: API yalnızca son 30g verir; satır = günlük birikim (hesap aktivitesine bağlı).",
    ],
    tables: {
      GoogleAdsCampaign: {
        rows: campaignsTotal,
        rationale: "Hesap başı kampanya snapshot (REMOVED hariç, 30g harcama penceresi).",
      },
      GoogleAdsMetric: {
        rows: campaignsTotal * LOOKBACK.campaignDaily,
        rationale: `Mevcut model; ~kampanya×${LOOKBACK.campaignDaily}g (üst sınır; sıfır günler yok).`,
      },
      GoogleAdsKeywordDaily: {
        rows: keywordsTotal * LOOKBACK.keywordDaily,
        rationale: `~${keywordsTotal} kelime × ${LOOKBACK.keywordDaily}g.`,
      },
      GoogleAdsSearchTermDaily: {
        rows: Math.round((searchTerms7dTotal / 7) * LOOKBACK.searchTermDaily),
        rationale: `7g satır≈${searchTerms7dTotal} → gün≈${Math.round(searchTerms7dTotal / 7)} × ${LOOKBACK.searchTermDaily}g.`,
      },
      GoogleAdsMetricBreakdown_device: {
        rows: campaignsTotal * LOOKBACK.breakdownDaily * 3,
        rationale: "Kampanya×gün×~3 cihaz (MOBILE/DESKTOP/TABLET) üst sınır.",
      },
      GoogleAdsMetricBreakdown_hour: {
        rows: campaignsTotal * LOOKBACK.breakdownDaily * 24,
        rationale: "Kampanya×gün×24 saat — yüksek karton; gerekirse yalnızca ENABLED veya top-N.",
      },
      GoogleAdsImpressionShareDaily: {
        rows: campaignsTotal * LOOKBACK.impressionShareDaily,
        rationale: "Search kampanyalarında dolu; diğer tiplerde çoğunlukla null.",
      },
      GoogleAdsChangeEvent: {
        rows: null,
        rationale:
          "Hacim aktiviteye bağlı; probe’da sayılmadı. Günlük sync ile birikir (API 30g pencere).",
      },
      GoogleAdsAuctionInsightImport: {
        rows: null,
        rationale: "API erişimi yoksa CSV; satır = yüklenen rapor satırı.",
      },
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    apiVersion: API_VERSION,
    agencySpendTotal30d: Math.round(agencySpendTotal * 100) / 100,
    spendShareByChannel: spendShare,
    pmaxSpendSharePct:
      spendShare.find((s) => s.channel === "PERFORMANCE_MAX")?.sharePct ?? 0,
    auctionInsightSummary: {
      accountsOk: accountReports.filter((a) => a.auctionInsight?.ok).length,
      accountsDenied: accountReports.filter(
        (a) => a.auctionInsight && !a.auctionInsight.ok,
      ).length,
      sampleErrors: accountReports
        .filter((a) => a.auctionInsight && !a.auctionInsight.ok)
        .slice(0, 5)
        .map((a) => ({ slug: a.slug, error: a.auctionInsight?.error })),
    },
    rowEstimates,
    accounts: accountReports,
  };

  mkdirSync(resolve("docs"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(`\nWrote ${OUT}\n`);
  console.log(
    JSON.stringify(
      {
        apiVersion: API_VERSION,
        agencySpendTotal30d: report.agencySpendTotal30d,
        spendShareByChannel: spendShare,
        pmaxSpendSharePct: report.pmaxSpendSharePct,
        auctionInsightSummary: report.auctionInsightSummary,
        rowEstimates: report.rowEstimates,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
