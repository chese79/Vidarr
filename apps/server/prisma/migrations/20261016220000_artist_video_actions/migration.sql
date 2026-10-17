ALTER TABLE "MusicVideo" ADD COLUMN "isLiveConcert" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MusicVideo" ADD COLUMN "deletionState" TEXT;
ALTER TABLE "MusicVideo" ADD COLUMN "deletionError" TEXT;
ALTER TABLE "MusicVideo" ADD COLUMN "deletionTargets" TEXT;
ALTER TABLE "MusicVideo" ADD COLUMN "deletionNextAttemptAt" DATETIME;
ALTER TABLE "MusicVideo" ADD COLUMN "deletionAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "warnBeforeDelete" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ADD COLUMN "excludeDeletedVideosFromScans" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "DeletedVideoRecord" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "originalMusicVideoId" INTEGER NOT NULL,
  "artistId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "identities" TEXT NOT NULL,
  "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DeletedVideoRecord_originalMusicVideoId_key" ON "DeletedVideoRecord"("originalMusicVideoId");
CREATE INDEX "DeletedVideoRecord_artistId_idx" ON "DeletedVideoRecord"("artistId");
