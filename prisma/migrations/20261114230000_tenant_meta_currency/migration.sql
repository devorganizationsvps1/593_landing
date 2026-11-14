-- Meta hesap para birimi (yapı sync’ten). Tenant.currency ile karşılaştırılır.

ALTER TABLE "Tenant" ADD COLUMN "metaCurrency" TEXT NOT NULL DEFAULT '';
