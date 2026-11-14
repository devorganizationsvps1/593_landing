-- Panel içi bildirim (adım deneme limiti vb.)
-- Yalnızca yerel geliştirme DB'ye uygulanır; prod ayrı onay.

CREATE TABLE "PanelNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PanelNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PanelNotice_userId_readAt_createdAt_idx" ON "PanelNotice"("userId", "readAt", "createdAt");
CREATE INDEX "PanelNotice_tenantId_createdAt_idx" ON "PanelNotice"("tenantId", "createdAt");

ALTER TABLE "PanelNotice" ADD CONSTRAINT "PanelNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PanelNotice" ADD CONSTRAINT "PanelNotice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
