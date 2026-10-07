-- Structured, per-source artist genres (MusicBrainz + Last.fm kept side by side,
-- plus user edits). Additive only: Artist.genre keeps working as the mirrored
-- display/filter value, so existing data and consumers are untouched. Legacy
-- comma-separated Artist.genre values are read as-is until an artist's genres
-- are refreshed or edited.
ALTER TABLE "Artist" ADD COLUMN "genresRefreshedAt" DATETIME;

CREATE TABLE "ArtistGenre" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "artistId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "parent" TEXT,
  "source" TEXT NOT NULL,
  "votes" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArtistGenre_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ArtistGenre_artistId_name_source_key" ON "ArtistGenre"("artistId", "name", "source");
CREATE INDEX "ArtistGenre_name_idx" ON "ArtistGenre"("name");
