-- CreateTable
CREATE TABLE "ManagedServer" (
    "key" TEXT NOT NULL,
    "purchasedAt" DATE,
    "provider" TEXT,
    "monthlyCost" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "renewalDay" INTEGER,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedServer_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ServerSample" (
    "id" TEXT NOT NULL,
    "serverKey" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "up" BOOLEAN NOT NULL,
    "cpuPct" DOUBLE PRECISION,
    "memPct" DOUBLE PRECISION,
    "memTotalGb" DOUBLE PRECISION,
    "diskPct" DOUBLE PRECISION,
    "diskTotalGb" DOUBLE PRECISION,
    "netInMb" DOUBLE PRECISION,
    "netOutMb" DOUBLE PRECISION,
    "uptimeSec" INTEGER,

    CONSTRAINT "ServerSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerSiteCheck" (
    "id" TEXT NOT NULL,
    "serverKey" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "ms" INTEGER,
    "sslExpiresAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "ServerSiteCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerEvent" (
    "id" TEXT NOT NULL,
    "serverKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ServerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServerSample_serverKey_at_idx" ON "ServerSample"("serverKey", "at");

-- CreateIndex
CREATE INDEX "ServerSiteCheck_serverKey_host_at_idx" ON "ServerSiteCheck"("serverKey", "host", "at");

-- CreateIndex
CREATE INDEX "ServerEvent_serverKey_at_idx" ON "ServerEvent"("serverKey", "at");

-- CreateIndex
CREATE INDEX "ServerEvent_serverKey_kind_subject_resolvedAt_idx" ON "ServerEvent"("serverKey", "kind", "subject", "resolvedAt");

