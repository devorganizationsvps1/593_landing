-- CreateEnum
CREATE TYPE "AdChangePlatform" AS ENUM ('meta', 'google');

-- CreateEnum
CREATE TYPE "AdChangeSource" AS ENUM ('manual', 'analysis', 'scheduled');

-- CreateEnum
CREATE TYPE "AdChangePackageStatus" AS ENUM ('draft', 'pending', 'rejected', 'approved', 'applying', 'applied', 'failed', 'superseded');

-- CreateEnum
CREATE TYPE "AdChangeDecision" AS ENUM ('approve', 'reject');

-- CreateEnum
CREATE TYPE "AdChangeJobStatus" AS ENUM ('queued', 'running', 'waiting', 'succeeded', 'failed', 'review');

-- CreateEnum
CREATE TYPE "AdChangeStepStatus" AS ENUM ('pending', 'running', 'succeeded', 'skipped', 'failed', 'waiting');

-- CreateTable
CREATE TABLE "AdChangePackage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" "AdChangePlatform" NOT NULL,
    "source" "AdChangeSource" NOT NULL DEFAULT 'manual',
    "status" "AdChangePackageStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL DEFAULT '',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdChangePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdChangePackageVersion" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdChangePackageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdChangeApproval" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "decision" "AdChangeDecision" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdChangeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdChangeJob" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "AdChangeJobStatus" NOT NULL DEFAULT 'queued',
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdChangeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdChangeJobStep" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "dependsOn" TEXT,
    "status" "AdChangeStepStatus" NOT NULL DEFAULT 'pending',
    "request" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "metaObjectIds" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AdChangeJobStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdChangePackage_status_updatedAt_idx" ON "AdChangePackage"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AdChangePackage_tenantId_platform_updatedAt_idx" ON "AdChangePackage"("tenantId", "platform", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdChangePackageVersion_packageId_version_key" ON "AdChangePackageVersion"("packageId", "version");

-- CreateIndex
CREATE INDEX "AdChangeApproval_packageId_createdAt_idx" ON "AdChangeApproval"("packageId", "createdAt");

-- CreateIndex
CREATE INDEX "AdChangeApproval_versionId_idx" ON "AdChangeApproval"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "AdChangeJob_versionId_key" ON "AdChangeJob"("versionId");

-- CreateIndex
CREATE INDEX "AdChangeJob_status_createdAt_idx" ON "AdChangeJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AdChangeJobStep_jobId_sortOrder_idx" ON "AdChangeJobStep"("jobId", "sortOrder");

-- AddForeignKey
ALTER TABLE "AdChangePackage" ADD CONSTRAINT "AdChangePackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangePackage" ADD CONSTRAINT "AdChangePackage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangePackageVersion" ADD CONSTRAINT "AdChangePackageVersion_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "AdChangePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangePackageVersion" ADD CONSTRAINT "AdChangePackageVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangeApproval" ADD CONSTRAINT "AdChangeApproval_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "AdChangePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangeApproval" ADD CONSTRAINT "AdChangeApproval_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AdChangePackageVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangeApproval" ADD CONSTRAINT "AdChangeApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangeJob" ADD CONSTRAINT "AdChangeJob_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "AdChangePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangeJob" ADD CONSTRAINT "AdChangeJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AdChangePackageVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangeJobStep" ADD CONSTRAINT "AdChangeJobStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AdChangeJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
