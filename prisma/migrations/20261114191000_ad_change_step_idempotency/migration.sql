-- (a) Adım tekilliği — çift tıklama / retry aynı işi iki kez uygulamamalı.
ALTER TABLE "AdChangeJobStep" ADD COLUMN "idempotencyKey" TEXT;

-- NULL idempotencyKey satırları unique kısıtına girmez (PostgreSQL).
CREATE UNIQUE INDEX "AdChangeJobStep_jobId_idempotencyKey_key"
  ON "AdChangeJobStep"("jobId", "idempotencyKey");
