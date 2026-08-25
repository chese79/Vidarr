-- AlterTable
ALTER TABLE "LibraryConnector" ADD COLUMN "videoLibraryId" TEXT;

-- CreateTable
CREATE TABLE "Playlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlaylistItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "musicVideoId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaylistSync" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "remotePlaylistId" TEXT,
    "lastPushedAt" DATETIME,
    "lastPushStatus" TEXT,
    "lastPushError" TEXT,
    "unmatchedCount" INTEGER,
    CONSTRAINT "PlaylistSync_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistSync_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistItem_playlistId_musicVideoId_key" ON "PlaylistItem"("playlistId", "musicVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistSync_playlistId_connectorId_key" ON "PlaylistSync"("playlistId", "connectorId");
