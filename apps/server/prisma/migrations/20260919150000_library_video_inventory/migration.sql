CREATE TABLE "LibraryVideo" (
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
    CONSTRAINT "LibraryVideo_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LibraryVideo_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LibraryVideo_connectorId_externalId_key" ON "LibraryVideo"("connectorId", "externalId");
CREATE INDEX "LibraryVideo_normalizedArtistName_normalizedTitle_idx" ON "LibraryVideo"("normalizedArtistName", "normalizedTitle");
