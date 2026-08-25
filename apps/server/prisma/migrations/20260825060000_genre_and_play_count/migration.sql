-- AlterTable: Artist gains a user-editable / externally-matchable genre field
ALTER TABLE "Artist" ADD COLUMN "genre" TEXT;

-- AlterTable: MusicVideo gains a user-editable genre field
ALTER TABLE "MusicVideo" ADD COLUMN "genre" TEXT;

-- AlterTable: MusicVideoFile gains play-count fields, synced from a
-- Plex/Jellyfin library connector's watch stats for the matched item
ALTER TABLE "MusicVideoFile" ADD COLUMN "playCount" INTEGER;
ALTER TABLE "MusicVideoFile" ADD COLUMN "playCountSyncedAt" DATETIME;
