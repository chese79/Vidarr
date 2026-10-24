ALTER TABLE "Settings" ADD COLUMN "liveEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Artist" ADD COLUMN "liveDiscoveryStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Artist" ADD COLUMN "liveDiscoveryAttemptedAt" DATETIME;
ALTER TABLE "Artist" ADD COLUMN "liveDiscoveryCompletedAt" DATETIME;
ALTER TABLE "Artist" ADD COLUMN "liveDiscoveryError" TEXT;
CREATE TABLE "LiveDiscoveryItem" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "artistId" INTEGER NOT NULL, "kind" TEXT NOT NULL, "provider" TEXT NOT NULL,
 "externalId" TEXT NOT NULL, "title" TEXT NOT NULL, "url" TEXT NOT NULL,
 "evidence" TEXT NOT NULL DEFAULT '{}', "rank" INTEGER NOT NULL DEFAULT 0,
 "dismissed" BOOLEAN NOT NULL DEFAULT false, "recordingId" INTEGER, "performanceId" INTEGER,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "LiveDiscoveryItem_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LiveDiscoveryItem_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LiveDiscoveryItem_artistId_provider_externalId_key" ON "LiveDiscoveryItem"("artistId", "provider", "externalId");
CREATE INDEX "LiveDiscoveryItem_artistId_kind_dismissed_rank_id_idx" ON "LiveDiscoveryItem"("artistId", "kind", "dismissed", "rank", "id");
