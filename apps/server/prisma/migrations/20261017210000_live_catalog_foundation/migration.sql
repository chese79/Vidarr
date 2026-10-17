-- Additive candidate catalog only. No legacy rows, files, queues or counters change.
CREATE TABLE "LivePerformance" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "artistId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "performanceDate" TEXT,
  "venue" TEXT,
  "city" TEXT,
  "setting" TEXT NOT NULL DEFAULT 'concert',
  "style" TEXT NOT NULL DEFAULT 'unknown',
  "notes" TEXT NOT NULL DEFAULT '',
  "identityStatus" TEXT NOT NULL DEFAULT 'independent',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LivePerformance_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LivePerformance_artistId_performanceDate_id_idx" ON "LivePerformance"("artistId", "performanceDate", "id");
CREATE INDEX "LivePerformance_setting_style_id_idx" ON "LivePerformance"("setting", "style", "id");

CREATE TABLE "LiveSongPerformance" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "performanceId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "section" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'unknown',
  CONSTRAINT "LiveSongPerformance_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "LivePerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LiveSongPerformance_performanceId_position_key" ON "LiveSongPerformance"("performanceId", "position");

CREATE TABLE "Recording" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "musicVideoId" INTEGER,
  "title" TEXT NOT NULL,
  "claimedCoverage" TEXT NOT NULL DEFAULT 'unknown',
  "origin" TEXT NOT NULL DEFAULT 'unknown',
  "evidenceUrl" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Recording_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Recording_musicVideoId_idx" ON "Recording"("musicVideoId");
CREATE INDEX "Recording_reviewStatus_id_idx" ON "Recording"("reviewStatus", "id");

CREATE TABLE "RecordingPerformance" (
  "recordingId" INTEGER NOT NULL,
  "performanceId" INTEGER NOT NULL,
  PRIMARY KEY ("recordingId", "performanceId"),
  CONSTRAINT "RecordingPerformance_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecordingPerformance_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "LivePerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RecordingPerformance_performanceId_idx" ON "RecordingPerformance"("performanceId");
