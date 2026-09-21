-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LibraryVideo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connectorId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "normalizedArtistName" TEXT NOT NULL,
    "releaseYear" INTEGER,
    "path" TEXT,
    "playCount" INTEGER,
    "hasThumbnail" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "musicVideoId" INTEGER,
    "matchConfidence" TEXT,
    "rejectedMusicVideoId" INTEGER,
    CONSTRAINT "LibraryVideo_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibraryVideo_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LibraryVideo_rejectedMusicVideoId_fkey" FOREIGN KEY ("rejectedMusicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LibraryVideo" ("artistName", "available", "connectorId", "externalId", "hasThumbnail", "id", "lastSyncedAt", "musicVideoId", "normalizedArtistName", "normalizedTitle", "path", "playCount", "releaseYear", "title") SELECT "artistName", "available", "connectorId", "externalId", "hasThumbnail", "id", "lastSyncedAt", "musicVideoId", "normalizedArtistName", "normalizedTitle", "path", "playCount", "releaseYear", "title" FROM "LibraryVideo";
DROP TABLE "LibraryVideo";
ALTER TABLE "new_LibraryVideo" RENAME TO "LibraryVideo";
CREATE INDEX "LibraryVideo_normalizedArtistName_normalizedTitle_idx" ON "LibraryVideo"("normalizedArtistName", "normalizedTitle");
CREATE UNIQUE INDEX "LibraryVideo_connectorId_externalId_key" ON "LibraryVideo"("connectorId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
