-- A download-client timeout can occur after the remote client accepted a
-- job. Keep that uncertain submission under the same one-active-job
-- invariant so an automatic retry cannot create a duplicate download.
DROP INDEX IF EXISTS "DownloadQueueItem_active_musicVideoId_key";

CREATE UNIQUE INDEX "DownloadQueueItem_active_musicVideoId_key"
ON "DownloadQueueItem"("musicVideoId")
WHERE "status" IN ('queued', 'downloading', 'submissionUnknown');
