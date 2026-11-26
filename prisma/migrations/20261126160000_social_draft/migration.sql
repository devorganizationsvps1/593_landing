-- Paylaşımlar "Taslağa al": paylaşım arşivde bekler, zamanlayıcı atlar.
ALTER TABLE "ContentPost" ADD COLUMN "socialDraftAt" TIMESTAMP(3);
