-- PROD — salt okunur kontroller. UPDATE/DELETE/INSERT yok.
-- Kullanım: psql "$DATABASE_URL" -f scripts/sql/prod-predeploy-readonly.sql

-- 1) AdChange* / PanelNotice tabloları
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND (
    tablename ILIKE 'AdChange%'
    OR tablename = 'PanelNotice'
  )
ORDER BY 1;

-- 2) Yeni enum değerleri
SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname IN (
  'AdChangePackageStatus',
  'AdChangeJobStatus',
  'AdChangeStepStatus'
)
ORDER BY 1, e.enumsortorder;

-- 3) Tenant yazma bayrakları kolonları
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Tenant'
  AND column_name LIKE 'metaAds%'
ORDER BY 1;

-- 4) AdChangeJobStep.idempotencyKey
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'AdChangeJobStep'
  AND column_name = 'idempotencyKey';

-- 5) Kuyrukta / çalışan job
SELECT status, COUNT(*) AS n
FROM "AdChangeJob"
WHERE status IN ('queued', 'running')
GROUP BY status
ORDER BY 1;

-- 6) Creative/analiz tabloları (prod'da OLMAMALI bu dağıtımda)
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND (
    tablename ILIKE 'Creative%'
    OR tablename ILIKE 'AdAnalysis%'
  )
ORDER BY 1;
