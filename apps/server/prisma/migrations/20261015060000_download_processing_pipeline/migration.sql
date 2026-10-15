ALTER TABLE "DownloadQueueItem" ADD COLUMN "downloadedPath" TEXT;
ALTER TABLE "DownloadQueueItem" ADD COLUMN "stagingDirectory" TEXT;
ALTER TABLE "DownloadQueueItem" ADD COLUMN "downloadedAt" DATETIME;
ALTER TABLE "DownloadQueueItem" ADD COLUMN "processingStartedAt" DATETIME;
ALTER TABLE "DownloadQueueItem" ADD COLUMN "phase" TEXT;
ALTER TABLE "DownloadQueueItem" ADD COLUMN "stageTimings" TEXT;
UPDATE "DownloadQueueItem" SET "phase" = 'legacy'
WHERE "sourceType" <> 'indexer' AND "status" IN ('downloading', 'importing');
