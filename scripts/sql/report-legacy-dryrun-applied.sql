-- Salt okunur: yazma kapalıyken / dry-run iken applied|succeeded görünen
-- AdChange job ve paket sayımı. Prod'da çalıştırın; UPDATE/DELETE yok.
--
-- Şüpheli job: status = 'succeeded'
--   VEYA (status IN ('applied','succeeded') AND adım dryRun/simulated/succeeded)

-- 1) Şüpheli job sayısı
SELECT COUNT(*) AS suspicious_job_count
FROM "AdChangeJob" j
WHERE j.status = 'succeeded'
   OR (
        j.status IN ('applied', 'succeeded')
        AND EXISTS (
          SELECT 1
          FROM "AdChangeJobStep" s
          WHERE s."jobId" = j.id
            AND (
              s.status = 'succeeded'
              OR (s.result ? 'dryRun' AND (s.result->>'dryRun')::boolean IS TRUE)
              OR (s.result ? 'simulated' AND (s.result->>'simulated')::boolean IS TRUE)
            )
        )
      );

-- 2) Bu job'lara bağlı hâlâ applied/approved görünen paket sayısı
SELECT COUNT(DISTINCT p.id) AS packages_still_marked_applied_or_approved
FROM "AdChangePackage" p
JOIN "AdChangeJob" j ON j."packageId" = p.id
WHERE p.status IN ('applied', 'approved')
  AND (
    j.status = 'succeeded'
    OR (
      j.status IN ('applied', 'succeeded')
      AND EXISTS (
        SELECT 1
        FROM "AdChangeJobStep" s
        WHERE s."jobId" = j.id
          AND (
            s.status = 'succeeded'
            OR (s.result ? 'dryRun' AND (s.result->>'dryRun')::boolean IS TRUE)
            OR (s.result ? 'simulated' AND (s.result->>'simulated')::boolean IS TRUE)
          )
      )
    )
  );

-- 3) Örnek job satırları (en fazla 20)
SELECT
  j.id AS job_id,
  j.status AS job_status,
  j."packageId",
  j."createdAt",
  (
    SELECT COUNT(*) FROM "AdChangeJobStep" s
    WHERE s."jobId" = j.id AND s.status = 'succeeded'
  ) AS succeeded_steps,
  (
    SELECT COUNT(*) FROM "AdChangeJobStep" s
    WHERE s."jobId" = j.id
      AND (s.result ? 'dryRun' AND (s.result->>'dryRun')::boolean IS TRUE)
  ) AS dry_run_steps
FROM "AdChangeJob" j
WHERE j.status = 'succeeded'
   OR (
        j.status IN ('applied', 'succeeded')
        AND EXISTS (
          SELECT 1 FROM "AdChangeJobStep" s
          WHERE s."jobId" = j.id
            AND (
              s.status = 'succeeded'
              OR (s.result ? 'dryRun' AND (s.result->>'dryRun')::boolean IS TRUE)
              OR (s.result ? 'simulated' AND (s.result->>'simulated')::boolean IS TRUE)
            )
        )
      )
ORDER BY j."createdAt" DESC
LIMIT 20;

-- 4) Örnek paketler
SELECT DISTINCT p.id, p.title, p.status, p."updatedAt"
FROM "AdChangePackage" p
JOIN "AdChangeJob" j ON j."packageId" = p.id
WHERE p.status IN ('applied', 'approved')
  AND (
    j.status = 'succeeded'
    OR (
      j.status IN ('applied', 'succeeded')
      AND EXISTS (
        SELECT 1 FROM "AdChangeJobStep" s
        WHERE s."jobId" = j.id
          AND (
            s.status = 'succeeded'
            OR (s.result ? 'dryRun' AND (s.result->>'dryRun')::boolean IS TRUE)
            OR (s.result ? 'simulated' AND (s.result->>'simulated')::boolean IS TRUE)
          )
      )
    )
  )
ORDER BY p."updatedAt" DESC
LIMIT 20;
