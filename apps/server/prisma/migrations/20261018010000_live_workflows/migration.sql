-- Atomic recording bridge and live workflows. Never move files or infer live events.
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
CREATE TEMP TABLE live_saved_sequences AS SELECT name,seq FROM sqlite_sequence;
CREATE TEMP TABLE live_migration_preflight (duplicates INTEGER CONSTRAINT Resolve_duplicate_active_downloads_before_live_migration CHECK (duplicates=0));
INSERT INTO live_migration_preflight SELECT COUNT(*) FROM (SELECT musicVideoId FROM DownloadQueueItem WHERE status IN ('queued','downloading','importing','submissionUnknown') GROUP BY musicVideoId HAVING COUNT(*)>1);
DROP TABLE live_migration_preflight;
-- CreateTable
CREATE TABLE "LiveConfiguration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "setlistApiKey" TEXT,
    "policy" TEXT NOT NULL DEFAULT '{}',
    "setlistPaused" BOOLEAN NOT NULL DEFAULT false,
    "providerRetryAt" DATETIME
);

-- CreateTable
CREATE TABLE "LiveCredit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "performanceId" INTEGER NOT NULL,
    "songId" INTEGER,
    "role" TEXT NOT NULL,
    CONSTRAINT "LiveCredit_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LiveCredit_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "LivePerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LiveCredit_songId_fkey" FOREIGN KEY ("songId") REFERENCES "LiveSongPerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordingSource" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordingId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecordingSource_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordingPart" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordingId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "rootFolderId" INTEGER,
    "path" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "storageIdentity" TEXT,
    "durationSeconds" REAL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "importedQueueId" INTEGER,
    "legacyMusicVideoFileId" INTEGER,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordingPart_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordingPart_rootFolderId_fkey" FOREIGN KEY ("rootFolderId") REFERENCES "RootFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordingPart_legacyMusicVideoFileId_fkey" FOREIGN KEY ("legacyMusicVideoFileId") REFERENCES "MusicVideoFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordingCoverage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partId" INTEGER NOT NULL,
    "songId" INTEGER NOT NULL,
    "startSeconds" REAL,
    "endSeconds" REAL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "fullSong" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RecordingCoverage_partId_fkey" FOREIGN KEY ("partId") REFERENCES "RecordingPart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordingCoverage_songId_fkey" FOREIGN KEY ("songId") REFERENCES "LiveSongPerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordingServerCopy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partId" INTEGER NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "libraryId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "expectedPath" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "playCount" INTEGER,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordingServerCopy_partId_fkey" FOREIGN KEY ("partId") REFERENCES "RecordingPart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordingServerCopy_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveMonitoringRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "performanceId" INTEGER,
    "tour" TEXT,
    "filters" TEXT NOT NULL DEFAULT '{}',
    "dailyBudget" INTEGER NOT NULL DEFAULT 50,
    "state" TEXT NOT NULL DEFAULT 'active',
    "cursor" INTEGER NOT NULL DEFAULT 1,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveMonitoringRule_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LiveMonitoringRule_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "LivePerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveRequestBudget" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "used" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "LiveSearchJournal" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "lastSearchAt" DATETIME,
    "retryAt" DATETIME,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "emptyCount" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "payload" TEXT,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LiveViewing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "performanceId" INTEGER NOT NULL,
    "watchedSeconds" REAL NOT NULL DEFAULT 0,
    "durationSeconds" REAL,
    "lastCreditAt" DATETIME,
    "qualifiedAt" DATETIME,
    "completedAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "positionSeconds" REAL NOT NULL DEFAULT 0,
    "partId" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveViewing_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "LivePerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LivePlaybackObservation" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "viewingId" INTEGER NOT NULL,
    "positionSeconds" REAL NOT NULL,
    "playing" BOOLEAN NOT NULL,
    "partId" INTEGER NOT NULL,
    "lastObservedAt" DATETIME NOT NULL,
    CONSTRAINT "LivePlaybackObservation_viewingId_fkey" FOREIGN KEY ("viewingId") REFERENCES "LiveViewing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveSongViewing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewingId" INTEGER NOT NULL,
    "songId" INTEGER NOT NULL,
    "watchedSeconds" REAL NOT NULL DEFAULT 0,
    "durationSeconds" REAL,
    "qualifiedAt" DATETIME,
    CONSTRAINT "LiveSongViewing_viewingId_fkey" FOREIGN KEY ("viewingId") REFERENCES "LiveViewing" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LiveSongViewing_songId_fkey" FOREIGN KEY ("songId") REFERENCES "LiveSongPerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveExclusion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LiveOccasion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "occasionDate" TEXT
);

-- RedefineTables
CREATE TABLE "new_AcquisitionSource" (
    "recordingId" INTEGER,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "discoveryOrigin" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AcquisitionSource_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AcquisitionSource_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AcquisitionSource" ("accepted", "authority", "confidence", "createdAt", "discoveryOrigin", "externalId", "id", "musicVideoId", "provider", "updatedAt", "url") SELECT "accepted", "authority", "confidence", "createdAt", "discoveryOrigin", "externalId", "id", "musicVideoId", "provider", "updatedAt", "url" FROM "AcquisitionSource";
DROP TABLE "AcquisitionSource";
ALTER TABLE "new_AcquisitionSource" RENAME TO "AcquisitionSource";
CREATE INDEX "AcquisitionSource_musicVideoId_authority_confidence_idx" ON "AcquisitionSource"("musicVideoId", "authority", "confidence");
CREATE UNIQUE INDEX "AcquisitionSource_musicVideoId_provider_url_key" ON "AcquisitionSource"("musicVideoId", "provider", "url");
CREATE TABLE "new_DownloadQueueItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER,
    "recordingId" INTEGER,
    "recordingSourceId" INTEGER,
    "selectedFiles" TEXT,
    "validationPolicy" TEXT,
    "rootFolderId" INTEGER,
    "partPosition" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "downloadClientId" INTEGER,
    "status" TEXT NOT NULL,
    "progress" REAL NOT NULL DEFAULT 0,
    "error" TEXT,
    "quality" TEXT,
    "downloadedPath" TEXT,
    "stagingDirectory" TEXT,
    "downloadedAt" DATETIME,
    "processingStartedAt" DATETIME,
    "phase" TEXT,
    "stageTimings" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuePosition" INTEGER NOT NULL DEFAULT 0,
    "validationCategory" TEXT NOT NULL DEFAULT 'additional',
    CONSTRAINT "DownloadQueueItem_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DownloadQueueItem_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DownloadQueueItem_recordingSourceId_fkey" FOREIGN KEY ("recordingSourceId") REFERENCES "RecordingSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DownloadQueueItem_rootFolderId_fkey" FOREIGN KEY ("rootFolderId") REFERENCES "RootFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DownloadQueueItem_downloadClientId_fkey" FOREIGN KEY ("downloadClientId") REFERENCES "DownloadClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DownloadQueueItem" ("addedAt", "downloadClientId", "downloadedAt", "downloadedPath", "error", "id", "musicVideoId", "phase", "processingStartedAt", "progress", "quality", "queuePosition", "sourceRef", "sourceType", "stageTimings", "stagingDirectory", "status", "validationCategory") SELECT "addedAt", "downloadClientId", "downloadedAt", "downloadedPath", "error", "id", "musicVideoId", "phase", "processingStartedAt", "progress", "quality", "queuePosition", "sourceRef", "sourceType", "stageTimings", "stagingDirectory", "status", "validationCategory" FROM "DownloadQueueItem";
DROP TABLE "DownloadQueueItem";
ALTER TABLE "new_DownloadQueueItem" RENAME TO "DownloadQueueItem";
CREATE INDEX "DownloadQueueItem_status_addedAt_id_idx" ON "DownloadQueueItem"("status", "addedAt", "id");
CREATE INDEX "DownloadQueueItem_status_queuePosition_addedAt_id_idx" ON "DownloadQueueItem"("status", "queuePosition", "addedAt", "id");
CREATE TABLE "new_History" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER,
    "recordingId" INTEGER,
    "eventType" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT,
    CONSTRAINT "History_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "History_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_History" ("data", "date", "eventType", "id", "musicVideoId") SELECT "data", "date", "eventType", "id", "musicVideoId" FROM "History";
DROP TABLE "History";
ALTER TABLE "new_History" RENAME TO "History";
CREATE TABLE "new_LibraryVideo" (
    "recordingId" INTEGER,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connectorId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "normalizedArtistName" TEXT NOT NULL,
    "releaseYear" INTEGER,
    "durationSeconds" INTEGER,
    "path" TEXT,
    "playCount" INTEGER,
    "hasThumbnail" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "musicVideoId" INTEGER,
    "matchConfidence" TEXT,
    "rejectedMusicVideoId" INTEGER,
    CONSTRAINT "LibraryVideo_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LibraryVideo_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibraryVideo_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LibraryVideo_rejectedMusicVideoId_fkey" FOREIGN KEY ("rejectedMusicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LibraryVideo" ("artistName", "available", "connectorId", "durationSeconds", "externalId", "hasThumbnail", "id", "lastSyncedAt", "matchConfidence", "musicVideoId", "normalizedArtistName", "normalizedTitle", "path", "playCount", "rejectedMusicVideoId", "releaseYear", "title") SELECT "artistName", "available", "connectorId", "durationSeconds", "externalId", "hasThumbnail", "id", "lastSyncedAt", "matchConfidence", "musicVideoId", "normalizedArtistName", "normalizedTitle", "path", "playCount", "rejectedMusicVideoId", "releaseYear", "title" FROM "LibraryVideo";
DROP TABLE "LibraryVideo";
ALTER TABLE "new_LibraryVideo" RENAME TO "LibraryVideo";
CREATE INDEX "LibraryVideo_normalizedArtistName_normalizedTitle_idx" ON "LibraryVideo"("normalizedArtistName", "normalizedTitle");
CREATE UNIQUE INDEX "LibraryVideo_connectorId_externalId_key" ON "LibraryVideo"("connectorId", "externalId");
CREATE TABLE "new_PlaylistItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "musicVideoId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "recordingPartId" INTEGER,
    "songId" INTEGER,
    "fullRecordingFallback" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_recordingPartId_fkey" FOREIGN KEY ("recordingPartId") REFERENCES "RecordingPart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "LiveSongPerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PlaylistItem" ("id", "musicVideoId", "playlistId", "sortOrder") SELECT "id", "musicVideoId", "playlistId", "sortOrder" FROM "PlaylistItem";
DROP TABLE "PlaylistItem";
ALTER TABLE "new_PlaylistItem" RENAME TO "PlaylistItem";
CREATE UNIQUE INDEX "PlaylistItem_playlistId_musicVideoId_key" ON "PlaylistItem"("playlistId", "musicVideoId");
CREATE TABLE "new_LivePerformance" (
    "removedAt" DATETIME,
    "occasionId" INTEGER,
    "localTime" TEXT,
    "timeZone" TEXT,
    "privateAddress" TEXT,
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
    "setlistFmId" TEXT,
    "venueExternalId" TEXT,
    "country" TEXT,
    "tour" TEXT,
    "sourceVersion" TEXT,
    "sourcePayload" TEXT,
    "correctionPayload" TEXT,
    "userEdited" BOOLEAN NOT NULL DEFAULT true,
    "referenceComplete" BOOLEAN NOT NULL DEFAULT false,
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "lastEvidenceAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSearchAt" DATETIME,
    "nextSearchAt" DATETIME,
    "emptySearches" INTEGER NOT NULL DEFAULT 0,
    "qualifiedPlayCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LivePerformance_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "LiveOccasion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LivePerformance_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LivePerformance" ("artistId", "city", "createdAt", "id", "identityStatus", "notes", "performanceDate", "revision", "setting", "style", "title", "updatedAt", "venue") SELECT "artistId", "city", "createdAt", "id", "identityStatus", "notes", "performanceDate", "revision", "setting", "style", "title", "updatedAt", "venue" FROM "LivePerformance";
DROP TABLE "LivePerformance";
ALTER TABLE "new_LivePerformance" RENAME TO "LivePerformance";
CREATE UNIQUE INDEX "LivePerformance_setlistFmId_key" ON "LivePerformance"("setlistFmId");
CREATE INDEX "LivePerformance_artistId_performanceDate_id_idx" ON "LivePerformance"("artistId", "performanceDate", "id");
CREATE INDEX "LivePerformance_setting_style_id_idx" ON "LivePerformance"("setting", "style", "id");
CREATE INDEX "LivePerformance_monitored_ignored_lastSearchAt_id_idx" ON "LivePerformance"("monitored", "ignored", "lastSearchAt", "id");
CREATE INDEX "LivePerformance_identityStatus_lastEvidenceAt_idx" ON "LivePerformance"("identityStatus", "lastEvidenceAt");
CREATE TABLE "new_LiveSongPerformance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "performanceId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'unknown',
    "musicbrainzWorkId" TEXT,
    "style" TEXT NOT NULL DEFAULT 'unknown',
    "durationSeconds" REAL,
    "qualifiedPlayCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LiveSongPerformance_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "LivePerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LiveSongPerformance" ("id", "kind", "performanceId", "position", "section", "title") SELECT "id", "kind", "performanceId", "position", "section", "title" FROM "LiveSongPerformance";
DROP TABLE "LiveSongPerformance";
ALTER TABLE "new_LiveSongPerformance" RENAME TO "LiveSongPerformance";
CREATE UNIQUE INDEX "LiveSongPerformance_performanceId_position_key" ON "LiveSongPerformance"("performanceId", "position");
CREATE TABLE "new_Recording" (
    "catalogType" TEXT NOT NULL DEFAULT 'live',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER,
    "title" TEXT NOT NULL,
    "claimedCoverage" TEXT NOT NULL DEFAULT 'unknown',
    "origin" TEXT NOT NULL DEFAULT 'unknown',
    "evidenceUrl" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "videoVerified" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "verifiedCoverage" INTEGER,
    "audioScore" REAL,
    "visualScore" REAL,
    "resolution" INTEGER,
    "qualityVerified" BOOLEAN NOT NULL DEFAULT false,
    "uninterruptedVerified" BOOLEAN NOT NULL DEFAULT false,
    "evidence" TEXT NOT NULL DEFAULT '{}',
    "deletionState" TEXT,
    "deletionError" TEXT,
    "deletionNextAttemptAt" DATETIME,
    "deletionTargets" TEXT,
    "deletionAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Recording_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Recording" ("claimedCoverage", "createdAt", "evidenceUrl", "id", "musicVideoId", "notes", "origin", "reviewStatus", "title") SELECT "claimedCoverage", "createdAt", "evidenceUrl", "id", "musicVideoId", "notes", "origin", "reviewStatus", "title" FROM "Recording";
DROP TABLE "Recording";
ALTER TABLE "new_Recording" RENAME TO "Recording";
CREATE INDEX "Recording_musicVideoId_idx" ON "Recording"("musicVideoId");
CREATE INDEX "Recording_reviewStatus_id_idx" ON "Recording"("reviewStatus", "id");
CREATE TABLE "new_RecordingPerformance" (
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "recordingId" INTEGER NOT NULL,
    "performanceId" INTEGER NOT NULL,

    PRIMARY KEY ("recordingId", "performanceId"),
    CONSTRAINT "RecordingPerformance_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordingPerformance_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "LivePerformance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RecordingPerformance" ("performanceId", "recordingId") SELECT "performanceId", "recordingId" FROM "RecordingPerformance";
DROP TABLE "RecordingPerformance";
ALTER TABLE "new_RecordingPerformance" RENAME TO "RecordingPerformance";
CREATE INDEX "RecordingPerformance_performanceId_idx" ON "RecordingPerformance"("performanceId");

-- CreateIndex
CREATE INDEX "LiveCredit_performanceId_songId_idx" ON "LiveCredit"("performanceId", "songId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingSource_provider_externalId_key" ON "RecordingSource"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingSource_recordingId_url_key" ON "RecordingSource"("recordingId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingPart_path_key" ON "RecordingPart"("path");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingPart_legacyMusicVideoFileId_key" ON "RecordingPart"("legacyMusicVideoFileId");

-- CreateIndex
CREATE INDEX "RecordingPart_sha256_idx" ON "RecordingPart"("sha256");

-- CreateIndex
CREATE INDEX "RecordingPart_rootFolderId_available_id_idx" ON "RecordingPart"("rootFolderId", "available", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingPart_recordingId_position_key" ON "RecordingPart"("recordingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingPart_importedQueueId_position_key" ON "RecordingPart"("importedQueueId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingCoverage_partId_songId_key" ON "RecordingCoverage"("partId", "songId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingServerCopy_connectorId_libraryId_externalId_key" ON "RecordingServerCopy"("connectorId", "libraryId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingServerCopy_partId_connectorId_key" ON "RecordingServerCopy"("partId", "connectorId");

-- CreateIndex
CREATE INDEX "LiveMonitoringRule_state_lastRunAt_idx" ON "LiveMonitoringRule"("state", "lastRunAt");

-- CreateIndex
CREATE INDEX "LiveMonitoringRule_artistId_state_id_idx" ON "LiveMonitoringRule"("artistId", "state", "id");

-- CreateIndex
CREATE INDEX "LiveSearchJournal_expiresAt_idx" ON "LiveSearchJournal"("expiresAt");

-- CreateIndex
CREATE INDEX "LiveViewing_serverKey_userId_performanceId_active_idx" ON "LiveViewing"("serverKey", "userId", "performanceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSongViewing_viewingId_songId_key" ON "LiveSongViewing"("viewingId", "songId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveExclusion_fingerprint_key" ON "LiveExclusion"("fingerprint");


UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT saved.seq FROM live_saved_sequences saved WHERE saved.name=sqlite_sequence.name),seq));
-- Music-video compatibility is one authoritative legacy writer with atomic shared references.
-- No event identities, watched-time conversions or file-system changes are inferred.
INSERT INTO Recording (musicVideoId,catalogType,title,reviewStatus,evidence,createdAt)
SELECT mv.id,'musicVideo',mv.title,'compatibility',json_object('legacyMusicVideoId',mv.id,'originalCatalogKind',mv.catalogKind),mv.addedAt
FROM MusicVideo mv WHERE NOT EXISTS (SELECT 1 FROM Recording r WHERE r.musicVideoId=mv.id);

INSERT INTO RecordingPart (recordingId,position,rootFolderId,path,sizeBytes,available,legacyMusicVideoFileId,durationSeconds)
SELECT r.id,1,CASE WHEN f.id IS NOT NULL THEN a.rootFolderId ELSE NULL END,
CASE WHEN (SELECT COUNT(*) FROM MusicVideoFile other WHERE other.path=f.path)=1 THEN f.path ELSE NULL END,
f.sizeBytes,CASE WHEN f.id IS NOT NULL AND mv.hasFile=1 THEN 1 ELSE 0 END,f.id,mv.durationSeconds
FROM Recording r JOIN MusicVideo mv ON mv.id=r.musicVideoId JOIN Artist a ON a.id=mv.artistId
LEFT JOIN MusicVideoFile f ON f.musicVideoId=mv.id
WHERE NOT EXISTS (SELECT 1 FROM RecordingPart p WHERE p.recordingId=r.id);

UPDATE AcquisitionSource SET recordingId=(SELECT r.id FROM Recording r WHERE r.musicVideoId=AcquisitionSource.musicVideoId ORDER BY r.id LIMIT 1);
UPDATE LibraryVideo SET recordingId=(SELECT r.id FROM Recording r WHERE r.musicVideoId=LibraryVideo.musicVideoId ORDER BY r.id LIMIT 1) WHERE musicVideoId IS NOT NULL;
UPDATE DownloadQueueItem SET recordingId=(SELECT r.id FROM Recording r WHERE r.musicVideoId=DownloadQueueItem.musicVideoId ORDER BY r.id LIMIT 1) WHERE musicVideoId IS NOT NULL;
UPDATE History SET recordingId=(SELECT r.id FROM Recording r WHERE r.musicVideoId=History.musicVideoId ORDER BY r.id LIMIT 1) WHERE musicVideoId IS NOT NULL;

CREATE TRIGGER MusicVideo_recording_insert AFTER INSERT ON MusicVideo BEGIN
  INSERT INTO Recording (musicVideoId,catalogType,title,reviewStatus,evidence,createdAt)
  VALUES (NEW.id,'musicVideo',NEW.title,'compatibility',json_object('legacyMusicVideoId',NEW.id,'originalCatalogKind',NEW.catalogKind),NEW.addedAt);
  INSERT INTO RecordingPart (recordingId,position,available,durationSeconds) VALUES (last_insert_rowid(),1,0,NEW.durationSeconds);
END;
CREATE TRIGGER MusicVideo_recording_update AFTER UPDATE OF title,durationSeconds,hasFile ON MusicVideo BEGIN
  UPDATE Recording SET title=NEW.title WHERE musicVideoId=NEW.id AND catalogType='musicVideo';
  UPDATE RecordingPart SET durationSeconds=NEW.durationSeconds,available=CASE WHEN NEW.hasFile=1 AND legacyMusicVideoFileId IS NOT NULL THEN 1 ELSE 0 END
    WHERE recordingId IN (SELECT id FROM Recording WHERE musicVideoId=NEW.id AND catalogType='musicVideo');
END;
CREATE TRIGGER MusicVideo_recording_delete BEFORE DELETE ON MusicVideo BEGIN
  UPDATE RecordingPart SET path=NULL,available=0 WHERE recordingId IN (SELECT id FROM Recording WHERE musicVideoId=OLD.id);
  UPDATE Recording SET evidence=json_set(evidence,'$.retiredQualifiedPlays',OLD.qualifiedPlayCount,'$.retiredNativePlays',
    (SELECT playCount FROM MusicVideoFile WHERE musicVideoId=OLD.id)),musicVideoId=NULL,reviewStatus='deleted',deletionState='deleted'
    WHERE musicVideoId=OLD.id;
END;

CREATE TRIGGER MusicVideoFile_recording_insert AFTER INSERT ON MusicVideoFile BEGIN
  UPDATE RecordingPart SET path=CASE WHEN EXISTS(SELECT 1 FROM RecordingPart other WHERE other.path=NEW.path AND other.id<>RecordingPart.id) THEN NULL ELSE NEW.path END,
    sizeBytes=NEW.sizeBytes,legacyMusicVideoFileId=NEW.id,rootFolderId=(SELECT rootFolderId FROM Artist WHERE id=(SELECT artistId FROM MusicVideo WHERE id=NEW.musicVideoId)),
    available=(SELECT hasFile FROM MusicVideo WHERE id=NEW.musicVideoId)
    WHERE recordingId=(SELECT id FROM Recording WHERE musicVideoId=NEW.musicVideoId ORDER BY id LIMIT 1) AND position=1;
END;
CREATE TRIGGER MusicVideoFile_recording_update AFTER UPDATE OF path,sizeBytes,musicVideoId ON MusicVideoFile BEGIN
  UPDATE RecordingCoverage SET verified=0,fullSong=0 WHERE partId IN (SELECT id FROM RecordingPart WHERE legacyMusicVideoFileId=NEW.id AND sizeBytes<>NEW.sizeBytes);
  UPDATE RecordingPart SET path=CASE WHEN EXISTS(SELECT 1 FROM RecordingPart other WHERE other.path=NEW.path AND other.id<>RecordingPart.id) THEN NULL ELSE NEW.path END,
    sizeBytes=NEW.sizeBytes,rootFolderId=(SELECT rootFolderId FROM Artist WHERE id=(SELECT artistId FROM MusicVideo WHERE id=NEW.musicVideoId))
    WHERE legacyMusicVideoFileId=NEW.id;
END;
CREATE TRIGGER MusicVideoFile_recording_delete BEFORE DELETE ON MusicVideoFile BEGIN
  UPDATE RecordingPart SET path=NULL,available=0,legacyMusicVideoFileId=NULL WHERE legacyMusicVideoFileId=OLD.id;
END;

CREATE TRIGGER AcquisitionSource_recording_insert AFTER INSERT ON AcquisitionSource BEGIN
  UPDATE AcquisitionSource SET recordingId=(SELECT id FROM Recording WHERE musicVideoId=NEW.musicVideoId ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER AcquisitionSource_recording_update AFTER UPDATE OF musicVideoId ON AcquisitionSource BEGIN
  UPDATE AcquisitionSource SET recordingId=(SELECT id FROM Recording WHERE musicVideoId=NEW.musicVideoId ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER LibraryVideo_recording_insert AFTER INSERT ON LibraryVideo WHEN NEW.musicVideoId IS NOT NULL BEGIN
  UPDATE LibraryVideo SET recordingId=(SELECT id FROM Recording WHERE musicVideoId=NEW.musicVideoId ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER LibraryVideo_recording_update AFTER UPDATE OF musicVideoId ON LibraryVideo BEGIN
  UPDATE LibraryVideo SET recordingId=(SELECT id FROM Recording WHERE musicVideoId=NEW.musicVideoId ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER DownloadQueueItem_recording_insert AFTER INSERT ON DownloadQueueItem WHEN NEW.musicVideoId IS NOT NULL AND NEW.recordingId IS NULL BEGIN
  UPDATE DownloadQueueItem SET recordingId=(SELECT id FROM Recording WHERE musicVideoId=NEW.musicVideoId ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER History_recording_insert AFTER INSERT ON History WHEN NEW.musicVideoId IS NOT NULL AND NEW.recordingId IS NULL BEGIN
  UPDATE History SET recordingId=(SELECT id FROM Recording WHERE musicVideoId=NEW.musicVideoId ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;

-- One reservation per capture; musicVideoId is a compatible typed reference to the same recording.
CREATE UNIQUE INDEX DownloadQueueItem_active_musicVideoId_key ON DownloadQueueItem(musicVideoId) WHERE status IN ('queued','downloading','submissionUnknown','importing');
CREATE UNIQUE INDEX DownloadQueueItem_active_recordingId_key ON DownloadQueueItem(recordingId) WHERE status IN ('queued','downloading','submissionUnknown','importing');
CREATE TRIGGER DownloadQueueItem_target_insert BEFORE INSERT ON DownloadQueueItem WHEN
 (NEW.musicVideoId IS NULL AND NEW.recordingId IS NULL) OR
 (NEW.musicVideoId IS NOT NULL AND NEW.recordingId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM Recording WHERE id=NEW.recordingId AND musicVideoId=NEW.musicVideoId))
 BEGIN SELECT RAISE(ABORT,'Queue requires one capture with a matching compatibility reference'); END;
CREATE TRIGGER DownloadQueueItem_target_update BEFORE UPDATE ON DownloadQueueItem WHEN
 (NEW.musicVideoId IS NULL AND NEW.recordingId IS NULL) OR
 (NEW.musicVideoId IS NOT NULL AND NEW.recordingId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM Recording WHERE id=NEW.recordingId AND musicVideoId=NEW.musicVideoId))
 BEGIN SELECT RAISE(ABORT,'Queue requires one capture with a matching compatibility reference'); END;
CREATE TRIGGER PlaylistItem_target_insert BEFORE INSERT ON PlaylistItem WHEN (NEW.musicVideoId IS NULL)=(NEW.recordingPartId IS NULL) BEGIN SELECT RAISE(ABORT,'Playlist requires exactly one typed target'); END;
CREATE TRIGGER PlaylistItem_target_update BEFORE UPDATE ON PlaylistItem WHEN (NEW.musicVideoId IS NULL)=(NEW.recordingPartId IS NULL) BEGIN SELECT RAISE(ABORT,'Playlist requires exactly one typed target'); END;
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT saved.seq FROM live_saved_sequences saved WHERE saved.name=sqlite_sequence.name),seq));
DROP TABLE live_saved_sequences;
CREATE TEMP TABLE live_migration_integrity (violations INTEGER CHECK (violations=0));
INSERT INTO live_migration_integrity SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE live_migration_integrity;
COMMIT;
PRAGMA foreign_keys=ON;
