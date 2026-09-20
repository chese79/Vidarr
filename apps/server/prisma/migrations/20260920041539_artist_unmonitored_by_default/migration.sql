-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortName" TEXT NOT NULL,
    "imvdbArtistId" TEXT,
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "rootFolderId" INTEGER NOT NULL,
    "qualityProfileId" INTEGER NOT NULL,
    "posterUrl" TEXT,
    "genre" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artist_rootFolderId_fkey" FOREIGN KEY ("rootFolderId") REFERENCES "RootFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artist_qualityProfileId_fkey" FOREIGN KEY ("qualityProfileId") REFERENCES "QualityProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Artist" ("addedAt", "genre", "id", "imvdbArtistId", "monitored", "name", "posterUrl", "qualityProfileId", "rootFolderId", "sortName") SELECT "addedAt", "genre", "id", "imvdbArtistId", "monitored", "name", "posterUrl", "qualityProfileId", "rootFolderId", "sortName" FROM "Artist";
DROP TABLE "Artist";
ALTER TABLE "new_Artist" RENAME TO "Artist";
CREATE UNIQUE INDEX "Artist_imvdbArtistId_key" ON "Artist"("imvdbArtistId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
