-- (a) Meta kampanya + reklam seti yapı snapshot'ı (eklemeli).
-- Arşiv/silinmiş hariç tüm durumlar sync ile dolar; bütçe düzeyi denormalize.

CREATE TABLE "MetaCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metaAccountId" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "effectiveStatus" TEXT NOT NULL DEFAULT '',
    "dailyBudgetMinor" TEXT,
    "lifetimeBudgetMinor" TEXT,
    "budgetLevel" TEXT NOT NULL DEFAULT 'none',
    "budgetKind" TEXT NOT NULL DEFAULT 'none',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetaAdSet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metaAccountId" TEXT NOT NULL DEFAULT '',
    "adsetId" TEXT NOT NULL,
    "adsetName" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL DEFAULT '',
    "campaignName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "effectiveStatus" TEXT NOT NULL DEFAULT '',
    "dailyBudgetMinor" TEXT,
    "lifetimeBudgetMinor" TEXT,
    "budgetKind" TEXT NOT NULL DEFAULT 'none',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAdSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaCampaign_tenantId_campaignId_key" ON "MetaCampaign"("tenantId", "campaignId");
CREATE INDEX "MetaCampaign_tenantId_metaAccountId_idx" ON "MetaCampaign"("tenantId", "metaAccountId");
CREATE INDEX "MetaCampaign_tenantId_status_idx" ON "MetaCampaign"("tenantId", "status");
CREATE INDEX "MetaCampaign_tenantId_effectiveStatus_idx" ON "MetaCampaign"("tenantId", "effectiveStatus");

CREATE UNIQUE INDEX "MetaAdSet_tenantId_adsetId_key" ON "MetaAdSet"("tenantId", "adsetId");
CREATE INDEX "MetaAdSet_tenantId_campaignId_idx" ON "MetaAdSet"("tenantId", "campaignId");
CREATE INDEX "MetaAdSet_tenantId_metaAccountId_idx" ON "MetaAdSet"("tenantId", "metaAccountId");
CREATE INDEX "MetaAdSet_tenantId_status_idx" ON "MetaAdSet"("tenantId", "status");
CREATE INDEX "MetaAdSet_tenantId_effectiveStatus_idx" ON "MetaAdSet"("tenantId", "effectiveStatus");

CREATE INDEX "MetaAd_tenantId_campaignId_idx" ON "MetaAd"("tenantId", "campaignId");
CREATE INDEX "MetaAd_tenantId_adsetId_idx" ON "MetaAd"("tenantId", "adsetId");
CREATE INDEX "MetaAd_tenantId_status_idx" ON "MetaAd"("tenantId", "status");

ALTER TABLE "MetaCampaign" ADD CONSTRAINT "MetaCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetaAdSet" ADD CONSTRAINT "MetaAdSet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
