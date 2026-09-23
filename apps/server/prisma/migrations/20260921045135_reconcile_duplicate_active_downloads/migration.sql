-- The release immediately following this migration adds a partial unique
-- index for active downloads. Older Vidarr builds used a racy check-then-
-- insert guard, so a populated database may already contain duplicates that
-- would make CREATE UNIQUE INDEX fail and abort deployment.
--
-- Preserve every queue/history record, keep the newest attempt active, and
-- mark older duplicate attempts failed. This migration intentionally sorts
-- immediately before 20260921045136_grab_queue_dedup_unique_index so fresh
-- upgrades reconcile legacy data before the constraint is installed.
UPDATE "DownloadQueueItem"
SET "status" = 'failed'
WHERE "status" IN ('queued', 'downloading')
  AND "id" NOT IN (
    SELECT MAX("id")
    FROM "DownloadQueueItem"
    WHERE "status" IN ('queued', 'downloading')
    GROUP BY "musicVideoId"
  );
