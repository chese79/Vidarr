-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MusicVideo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "imvdbVideoId" TEXT,
    "youtubeVideoId" TEXT,
    "releaseYear" INTEGER,
    "director" TEXT,
    "genre" TEXT,
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "hasFile" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailUrl" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicVideo_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MusicVideo" ("addedAt", "artistId", "director", "genre", "hasFile", "id", "imvdbVideoId", "monitored", "normalizedTitle", "releaseYear", "thumbnailUrl", "title", "youtubeVideoId") SELECT "addedAt", "artistId", "director", "genre", "hasFile", "id", "imvdbVideoId", "monitored", "normalizedTitle", "releaseYear", "thumbnailUrl", "title", "youtubeVideoId" FROM "MusicVideo";
DROP TABLE "MusicVideo";
ALTER TABLE "new_MusicVideo" RENAME TO "MusicVideo";
CREATE UNIQUE INDEX "MusicVideo_imvdbVideoId_key" ON "MusicVideo"("imvdbVideoId");
CREATE UNIQUE INDEX "MusicVideo_youtubeVideoId_key" ON "MusicVideo"("youtubeVideoId");
CREATE UNIQUE INDEX "MusicVideo_artistId_normalizedTitle_key" ON "MusicVideo"("artistId", "normalizedTitle");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
