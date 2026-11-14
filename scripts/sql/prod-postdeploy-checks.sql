-- PROD — dağıtım sonrası salt okunur.
-- Bayraklar kapalı + son meta_write audit satırları.

-- 1) Tüm tenant yazma bayrakları kapalı mı?
SELECT
  COUNT(*) AS tenants,
  COUNT(*) FILTER (WHERE "metaAdsWriteEnabled") AS write_on,
  COUNT(*) FILTER (WHERE "metaAdsWriteTierK1") AS k1_on,
  COUNT(*) FILTER (WHERE "metaAdsWriteTierK2") AS k2_on,
  COUNT(*) FILTER (WHERE "metaAdsWriteTierK3") AS k3_on,
  COUNT(*) FILTER (WHERE "metaAdsWriteTierK4") AS k4_on
FROM "Tenant";

-- Açık kalan varsa listele (beklenen: 0 satır)
SELECT id, slug, name,
  "metaAdsWriteEnabled",
  "metaAdsWriteTierK1",
  "metaAdsWriteTierK2",
  "metaAdsWriteTierK3",
  "metaAdsWriteTierK4"
FROM "Tenant"
WHERE "metaAdsWriteEnabled"
   OR "metaAdsWriteTierK1"
   OR "metaAdsWriteTierK2"
   OR "metaAdsWriteTierK3"
   OR "metaAdsWriteTierK4";

-- 2) Son 10 meta_write AuditLog
SELECT
  "createdAt",
  action,
  "entityId",
  "tenantId",
  summary,
  after
FROM "AuditLog"
WHERE entity = 'meta_write'
ORDER BY "createdAt" DESC
LIMIT 10;
