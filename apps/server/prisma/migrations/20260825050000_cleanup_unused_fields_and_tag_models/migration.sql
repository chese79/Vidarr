-- DropForeignKey / DropTable: Tag / TagOnArtist were never read or written
-- anywhere in the app (confirmed via grep across apps/server/src) — dead
-- models from the original M1 schema design that were never wired up.
PRAGMA foreign_keys=OFF;
DROP TABLE "TagOnArtist";
DROP TABLE "Tag";
PRAGMA foreign_keys=ON;

-- RedefineTable: drop Indexer.supportsRss / supportsSearch (never read or
-- written anywhere in the app — RSS sync was never built, and "search"
-- support is assumed for every indexer, not configurable).
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Indexer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "implementation" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT,
    "categories" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 25
);
INSERT INTO "new_Indexer" ("id", "name", "implementation", "baseUrl", "apiKey", "categories", "enabled", "priority")
SELECT "id", "name", "implementation", "baseUrl", "apiKey", "categories", "enabled", "priority" FROM "Indexer";
DROP TABLE "Indexer";
ALTER TABLE "new_Indexer" RENAME TO "Indexer";
PRAGMA foreign_keys=ON;

-- RedefineTable: drop DownloadQueueItem.outputPath (never read or written
-- anywhere in the app — the completed path is looked up fresh from the
-- download client / yt-dlp at import time instead).
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DownloadQueueItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "downloadClientId" INTEGER,
    "status" TEXT NOT NULL,
    "progress" REAL NOT NULL DEFAULT 0,
    "quality" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DownloadQueueItem_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DownloadQueueItem_downloadClientId_fkey" FOREIGN KEY ("downloadClientId") REFERENCES "DownloadClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DownloadQueueItem" ("id", "musicVideoId", "sourceType", "sourceRef", "downloadClientId", "status", "progress", "quality", "addedAt")
SELECT "id", "musicVideoId", "sourceType", "sourceRef", "downloadClientId", "status", "progress", "quality", "addedAt" FROM "DownloadQueueItem";
DROP TABLE "DownloadQueueItem";
ALTER TABLE "new_DownloadQueueItem" RENAME TO "DownloadQueueItem";
PRAGMA foreign_keys=ON;
