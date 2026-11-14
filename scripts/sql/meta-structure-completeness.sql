-- (a) Meta yapı sync eksiksizlik — salt okunur.
-- Kullanım: psql "$DATABASE_URL" -f scripts/sql/meta-structure-completeness.sql

-- 1) Satır sayıları
SELECT 'MetaCampaign' AS entity, COUNT(*) AS n FROM "MetaCampaign"
UNION ALL SELECT 'MetaAdSet', COUNT(*) FROM "MetaAdSet"
UNION ALL SELECT 'MetaAd', COUNT(*) FROM "MetaAd";

-- 2) Kampanya: boş kimlik / ad, bütçe alanı
SELECT
  COUNT(*) AS campaigns,
  COUNT(*) FILTER (WHERE "campaignId" = '' OR "campaignId" IS NULL) AS no_id,
  COUNT(*) FILTER (WHERE "campaignName" = '') AS no_name,
  COUNT(*) FILTER (WHERE "status" = '') AS no_status,
  COUNT(*) FILTER (WHERE "effectiveStatus" = '') AS no_effective,
  COUNT(*) FILTER (WHERE "metaAccountId" = '') AS no_account,
  COUNT(*) FILTER (WHERE "budgetLevel" = 'campaign') AS cbo,
  COUNT(*) FILTER (WHERE "budgetLevel" = 'adset') AS abo,
  COUNT(*) FILTER (WHERE "budgetKind" = 'lifetime') AS lifetime_budget,
  COUNT(*) FILTER (WHERE "budgetKind" = 'daily') AS daily_budget
FROM "MetaCampaign"
WHERE "effectiveStatus" NOT IN ('DELETED', 'ARCHIVED');

-- 3) Set: kampanya bağlantısı
SELECT
  COUNT(*) AS adsets,
  COUNT(*) FILTER (WHERE "adsetId" = '') AS no_id,
  COUNT(*) FILTER (WHERE "campaignId" = '' OR "campaignId" IS NULL) AS no_campaign_id,
  COUNT(*) FILTER (WHERE "campaignName" = '') AS no_campaign_name,
  COUNT(*) FILTER (WHERE "status" = '') AS no_status,
  COUNT(*) FILTER (WHERE "budgetKind" = 'lifetime') AS lifetime_budget,
  COUNT(*) FILTER (WHERE "budgetKind" = 'daily') AS daily_budget
FROM "MetaAdSet"
WHERE "effectiveStatus" NOT IN ('DELETED', 'ARCHIVED');

-- 4) Reklam: kampanya/set bağlantısı
SELECT
  COUNT(*) AS ads,
  COUNT(*) FILTER (WHERE "campaignId" = '' OR "campaignId" IS NULL) AS no_campaign_id,
  COUNT(*) FILTER (WHERE "campaignName" = '') AS no_campaign_name,
  COUNT(*) FILTER (WHERE "adsetId" = '') AS no_adset_id,
  COUNT(*) FILTER (WHERE "adsetName" = '') AS no_adset_name,
  COUNT(*) FILTER (WHERE "status" = '') AS no_status,
  COUNT(*) FILTER (WHERE UPPER("status") = 'PAUSED') AS status_paused,
  COUNT(*) FILTER (WHERE UPPER("effectiveStatus") = 'PAUSED') AS eff_paused,
  COUNT(*) FILTER (WHERE UPPER("effectiveStatus") = 'ACTIVE') AS eff_active
FROM "MetaAd"
WHERE "effectiveStatus" NOT IN ('DELETED', 'ARCHIVED');

-- 5) Para birimi uyuşmazlığı
SELECT
  id,
  slug,
  name,
  currency AS panel_currency,
  "metaCurrency" AS meta_account_currency
FROM "Tenant"
WHERE "metaCurrency" <> ''
  AND UPPER(currency) <> UPPER("metaCurrency")
ORDER BY slug;

-- 6) Reklam → MetaCampaign / MetaAdSet eşleşmesi (yetim satırlar)
SELECT
  COUNT(*) FILTER (
    WHERE a."campaignId" <> '' AND c."campaignId" IS NULL
  ) AS ads_missing_campaign_row,
  COUNT(*) FILTER (
    WHERE a."adsetId" <> '' AND s."adsetId" IS NULL
  ) AS ads_missing_adset_row
FROM "MetaAd" a
LEFT JOIN "MetaCampaign" c
  ON c."tenantId" = a."tenantId" AND c."campaignId" = a."campaignId"
LEFT JOIN "MetaAdSet" s
  ON s."tenantId" = a."tenantId" AND s."adsetId" = a."adsetId"
WHERE a."effectiveStatus" NOT IN ('DELETED', 'ARCHIVED');
