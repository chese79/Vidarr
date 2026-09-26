CREATE TABLE "LibraryRecording" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "connectorId" INTEGER NOT NULL,
  "filePath" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "album" TEXT,
  "artistName" TEXT NOT NULL,
  "albumArtistName" TEXT,
  "genre" TEXT,
  "trackNumber" INTEGER,
  "discNumber" INTEGER,
  "musicbrainzArtistId" TEXT,
  "musicbrainzAlbumArtistId" TEXT,
  "musicbrainzRecordingId" TEXT,
  "musicbrainzReleaseId" TEXT,
  "musicbrainzReleaseGroupId" TEXT,
  "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryRecording_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryRecording_connectorId_filePath_key" ON "LibraryRecording"("connectorId", "filePath");
CREATE INDEX "LibraryRecording_musicbrainzArtistId_idx" ON "LibraryRecording"("musicbrainzArtistId");
CREATE INDEX "LibraryRecording_musicbrainzRecordingId_idx" ON "LibraryRecording"("musicbrainzRecordingId");
