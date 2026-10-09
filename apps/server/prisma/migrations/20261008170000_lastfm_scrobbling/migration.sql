CREATE TABLE "LastFmAccount" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "username" TEXT, "sessionKey" TEXT, "pendingToken" TEXT,
  "pendingExpiresAt" DATETIME, "scrobblingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lastPollAt" DATETIME, "lastScrobbledAt" DATETIME, "lastError" TEXT
);
CREATE TABLE "LastFmPlayback" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "connectorId" INTEGER NOT NULL, "libraryId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL, "externalId" TEXT NOT NULL,
  "artist" TEXT NOT NULL, "track" TEXT NOT NULL,
  "durationSeconds" REAL NOT NULL, "startedAt" INTEGER NOT NULL,
  "lastObservedAt" DATETIME NOT NULL, "positionSeconds" REAL NOT NULL,
  "playing" BOOLEAN NOT NULL, "listenedSeconds" REAL NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true, "nowPlayingSent" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" DATETIME, "lastError" TEXT
);
CREATE INDEX "LastFmPlayback_connectorId_sessionId_active_idx" ON "LastFmPlayback"("connectorId", "sessionId", "active");
CREATE INDEX "LastFmPlayback_status_startedAt_idx" ON "LastFmPlayback"("status", "startedAt");
