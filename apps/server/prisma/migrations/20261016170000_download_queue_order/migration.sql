ALTER TABLE "DownloadQueueItem" ADD COLUMN "queuePosition" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "DownloadQueueItem_status_queuePosition_addedAt_id_idx" ON "DownloadQueueItem"("status", "queuePosition", "addedAt", "id");
