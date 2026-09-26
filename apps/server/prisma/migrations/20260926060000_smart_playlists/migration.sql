ALTER TABLE "Playlist" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'static';
ALTER TABLE "Playlist" ADD COLUMN "ruleFilters" TEXT;
ALTER TABLE "Playlist" ADD COLUMN "ruleMatchMode" TEXT;
ALTER TABLE "Playlist" ADD COLUMN "regenerateIntervalMinutes" INTEGER;
ALTER TABLE "Playlist" ADD COLUMN "lastGeneratedAt" DATETIME;
