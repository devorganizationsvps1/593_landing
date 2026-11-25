-- K2a: paket inceleme durumu + sahipsiz kreatif listesi
ALTER TABLE "AdChangePackage" ADD COLUMN IF NOT EXISTS "metaReviewStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AdChangePackage" ADD COLUMN IF NOT EXISTS "metaReviewFeedback" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "MetaOrphanCreative" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL DEFAULT '',
    "creativeId" TEXT NOT NULL,
    "adId" TEXT NOT NULL DEFAULT '',
    "packageId" TEXT,
    "jobId" TEXT,
    "stepId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaOrphanCreative_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MetaOrphanCreative_tenantId_creativeId_key" ON "MetaOrphanCreative"("tenantId", "creativeId");
CREATE INDEX IF NOT EXISTS "MetaOrphanCreative_tenantId_resolvedAt_createdAt_idx" ON "MetaOrphanCreative"("tenantId", "resolvedAt", "createdAt");

DO $$ BEGIN
  ALTER TABLE "MetaOrphanCreative" ADD CONSTRAINT "MetaOrphanCreative_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
