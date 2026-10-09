ALTER TABLE "Settings" ADD COLUMN "defaultPlaybackConnectorId" INTEGER;
ALTER TABLE "Playlist" ADD COLUMN "maxVideos" INTEGER;
-- Empty legacy smart rules matched nothing. Preserve that behavior when new
-- empty rules mean all eligible videos; users can clear this explicit filter.
UPDATE "Playlist" SET "ruleFilters" = '{"musicVideoIds":[-1]}'
WHERE "kind" = 'smart' AND trim("ruleFilters") IN ('{}', '{"qualityIds":[]}');
