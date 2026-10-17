ALTER TABLE "MusicVideo" ADD COLUMN "qualifiedPlayCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MusicVideo" ADD COLUMN "lastQualifiedPlayAt" DATETIME;
CREATE TABLE "QualifiedPlayback" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "musicVideoId" INTEGER NOT NULL,
  "connectorId" INTEGER NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "libraryId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "userId" TEXT,
  "durationSeconds" REAL NOT NULL,
  "positionSeconds" REAL NOT NULL,
  "playing" BOOLEAN NOT NULL,
  "listenedSeconds" REAL NOT NULL DEFAULT 0,
  "qualifiedAt" DATETIME,
  "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" DATETIME NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "QualifiedPlayback_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QualifiedPlayback_sourceKey_sessionId_active_idx" ON "QualifiedPlayback"("sourceKey", "sessionId", "active");
CREATE INDEX "QualifiedPlayback_active_lastObservedAt_idx" ON "QualifiedPlayback"("active", "lastObservedAt");
