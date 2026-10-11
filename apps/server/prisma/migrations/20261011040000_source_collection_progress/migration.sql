ALTER TABLE "Artist" ADD COLUMN "videoInventoryAttemptedAt" DATETIME;
ALTER TABLE "Artist" ADD COLUMN "videoInventoryCompletedAt" DATETIME;
ALTER TABLE "Artist" ADD COLUMN "videoInventoryStatus" TEXT NOT NULL DEFAULT 'pending';
UPDATE "Artist" SET
  "videoInventoryAttemptedAt" = "videoInventoryCheckedAt",
  "videoInventoryCompletedAt" = CASE WHEN "videoInventoryError" IS NULL THEN "videoInventoryCheckedAt" ELSE NULL END,
  "videoInventoryStatus" = CASE WHEN "videoInventoryError" IS NULL THEN 'complete' ELSE 'partial' END
WHERE "videoInventoryCheckedAt" IS NOT NULL;
