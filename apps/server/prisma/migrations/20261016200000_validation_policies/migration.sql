ALTER TABLE "Settings" ADD COLUMN "validationSettings" TEXT NOT NULL DEFAULT '{"policies":{"imports":{"file":true,"motion":true},"canonical":{"file":false,"motion":false},"additional":{"file":true,"motion":true}},"minimumDimension":64,"maximumStaticPercent":80}';
ALTER TABLE "DownloadQueueItem" ADD COLUMN "validationCategory" TEXT NOT NULL DEFAULT 'additional';
-- Classify the selected source, never infer trust from an official catalog title.
UPDATE "DownloadQueueItem" SET "validationCategory" = 'canonical'
WHERE "sourceType" IN ('youtube', 'vimeo') AND EXISTS (
  SELECT 1 FROM "AcquisitionSource" s
  WHERE s."musicVideoId" = "DownloadQueueItem"."musicVideoId"
    AND s."url" = "DownloadQueueItem"."sourceRef"
    AND s."provider" = "DownloadQueueItem"."sourceType"
    AND s."accepted" = 1 AND s."confidence" = 'confirmed'
    AND s."authority" IN ('authoritative', 'verified')
);
