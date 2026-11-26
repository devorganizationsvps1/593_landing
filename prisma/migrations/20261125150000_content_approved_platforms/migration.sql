-- İçerik onay durumu: otomatik paylaşım yalnızca "approved" içerikte çalışır.
ALTER TYPE "ContentPostStatus" ADD VALUE IF NOT EXISTS 'approved' BEFORE 'published';

-- Çoklu platform: mevcut içeriklerde tek platform listeye taşınır.
ALTER TABLE "ContentPost" ADD COLUMN "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "ContentPost" SET "platforms" = ARRAY["platform"] WHERE cardinality("platforms") = 0;
