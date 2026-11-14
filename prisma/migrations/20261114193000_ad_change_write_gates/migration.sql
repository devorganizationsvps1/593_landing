-- (b) Dry-run / partial durumları + tenant yazma kapıları (varsayılan kapalı).
-- Hedef: yalnızca yerel geliştirme DB (localhost agency_593).

ALTER TYPE "AdChangePackageStatus" ADD VALUE 'simulated';
ALTER TYPE "AdChangePackageStatus" ADD VALUE 'partial';
ALTER TYPE "AdChangePackageStatus" ADD VALUE 'skipped';

ALTER TYPE "AdChangeJobStatus" ADD VALUE 'applied';
ALTER TYPE "AdChangeJobStatus" ADD VALUE 'simulated';
ALTER TYPE "AdChangeJobStatus" ADD VALUE 'partial';
ALTER TYPE "AdChangeJobStatus" ADD VALUE 'skipped';

ALTER TYPE "AdChangeStepStatus" ADD VALUE 'applied';
ALTER TYPE "AdChangeStepStatus" ADD VALUE 'simulated';

ALTER TABLE "Tenant" ADD COLUMN "metaAdsWriteEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "metaAdsWriteTierK1" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "metaAdsWriteTierK2" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "metaAdsWriteTierK3" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "metaAdsWriteTierK4" BOOLEAN NOT NULL DEFAULT false;
