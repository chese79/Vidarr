ALTER TABLE "ScheduledTask" ADD COLUMN "scheduleType" TEXT NOT NULL DEFAULT 'interval';
ALTER TABLE "ScheduledTask" ADD COLUMN "timeOfDay" TEXT;
ALTER TABLE "ScheduledTask" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE "ScheduledTask" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ScheduledTask" ADD COLUMN "nextRunAt" DATETIME;
ALTER TABLE "ScheduledTask" ADD COLUMN "windowStart" TEXT;
ALTER TABLE "ScheduledTask" ADD COLUMN "windowEnd" TEXT;
ALTER TABLE "ScheduledTask" ADD COLUMN "continuePending" BOOLEAN NOT NULL DEFAULT true;
UPDATE "ScheduledTask" SET "windowStart" = '02:00', "windowEnd" = '10:00'
WHERE "name" IN ('Artist Identity Suggestions', 'Music Video Metadata Enrichment',
 'Existing Artist Source Discovery', 'Live Starting Inventory', 'Live Candidate Matching',
 'Live Event Metadata', 'Live Discovery', 'Artist Genre Backfill', 'Artist Video Inventory Backfill',
 'Smart Playlist Regeneration', 'YouTube Channel Poll', 'Missing/Wanted Backlog Search',
 'IMVDb Metadata Refresh', 'Quality Upgrade Search', 'Log Cleanup');
