-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('facebook', 'instagram', 'tiktok', 'youtube');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('pending', 'publishing', 'published', 'failed');

-- AlterTable
ALTER TABLE "ContentPost" ADD COLUMN     "autoPublish" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "pictureUrl" TEXT,
    "authSource" TEXT NOT NULL DEFAULT 'oauth',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "parentExternalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMedia" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,
    "originalName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPostTarget" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "socialAccountId" TEXT,
    "format" TEXT NOT NULL,
    "captionOverride" TEXT,
    "title" TEXT,
    "privacy" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "progressRef" TEXT,
    "externalId" TEXT,
    "permalink" TEXT,
    "lastError" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPostTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_platform_externalId_idx" ON "SocialAccount"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_tenantId_platform_key" ON "SocialAccount"("tenantId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ContentMedia_storageKey_key" ON "ContentMedia"("storageKey");

-- CreateIndex
CREATE INDEX "ContentMedia_postId_position_idx" ON "ContentMedia"("postId", "position");

-- CreateIndex
CREATE INDEX "ContentPostTarget_status_nextAttemptAt_idx" ON "ContentPostTarget"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPostTarget_postId_platform_key" ON "ContentPostTarget"("postId", "platform");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentMedia" ADD CONSTRAINT "ContentMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPostTarget" ADD CONSTRAINT "ContentPostTarget_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPostTarget" ADD CONSTRAINT "ContentPostTarget_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

