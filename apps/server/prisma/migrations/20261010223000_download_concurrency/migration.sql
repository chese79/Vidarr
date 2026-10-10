ALTER TABLE "Settings" ADD COLUMN "maxConcurrentDownloads" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "DownloadQueueItem" ADD COLUMN "error" TEXT;
