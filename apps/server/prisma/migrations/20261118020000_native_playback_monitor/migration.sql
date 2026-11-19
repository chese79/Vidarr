ALTER TABLE "LibraryVideo" ADD COLUMN "libraryId" TEXT;
ALTER TABLE "LibraryConnector" ADD COLUMN "videoSyncRunning" BOOLEAN NOT NULL DEFAULT false;
UPDATE "LibraryVideo" SET "libraryId" = (SELECT "videoLibraryId" FROM "LibraryConnector" WHERE "LibraryConnector"."id" = "LibraryVideo"."connectorId");
CREATE TABLE "PlaybackObservation" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "connectorId" INTEGER NOT NULL, "scope" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
 "userId" TEXT NOT NULL, "externalId" TEXT NOT NULL, "title" TEXT NOT NULL,
 "artistName" TEXT, "userName" TEXT, "deviceName" TEXT,
 "positionSeconds" REAL NOT NULL, "playing" BOOLEAN NOT NULL, "lastSeenAt" DATETIME NOT NULL,
 CONSTRAINT "PlaybackObservation_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlaybackObservation_connectorId_sessionId_key" ON "PlaybackObservation"("connectorId", "sessionId");
CREATE INDEX "PlaybackObservation_lastSeenAt_idx" ON "PlaybackObservation"("lastSeenAt");
CREATE TABLE "PlayCountRefresh" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "connectorId" INTEGER NOT NULL, "scope" TEXT NOT NULL, "externalId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "baselineCount" INTEGER, "lastCount" INTEGER, "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT,
 CONSTRAINT "PlayCountRefresh_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlayCountRefresh_connectorId_externalId_userId_key" ON "PlayCountRefresh"("connectorId", "externalId", "userId");
CREATE INDEX "PlayCountRefresh_nextAttemptAt_idx" ON "PlayCountRefresh"("nextAttemptAt");
