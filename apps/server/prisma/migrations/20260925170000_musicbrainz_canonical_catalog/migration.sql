-- Add MusicBrainz identity and review state without changing existing artist ids.
ALTER TABLE "Artist" ADD COLUMN "musicbrainzArtistId" TEXT;
ALTER TABLE "Artist" ADD COLUMN "musicbrainzMatchStatus" TEXT NOT NULL DEFAULT 'unmatched';
ALTER TABLE "Artist" ADD COLUMN "musicbrainzMatchConfidence" REAL;
ALTER TABLE "Artist" ADD COLUMN "musicbrainzMatchEvidence" TEXT;
ALTER TABLE "Artist" ADD COLUMN "musicbrainzRefreshedAt" DATETIME;
ALTER TABLE "Artist" ADD COLUMN "artistType" TEXT;
ALTER TABLE "Artist" ADD COLUMN "country" TEXT;
ALTER TABLE "Artist" ADD COLUMN "disambiguation" TEXT;
ALTER TABLE "Artist" ADD COLUMN "genreSource" TEXT;
CREATE UNIQUE INDEX "Artist_musicbrainzArtistId_key" ON "Artist"("musicbrainzArtistId");

-- Catalog authority is explicit: old IMVDb rows are official; every other
-- pre-existing row remains visible as inventory and is excluded from official
-- completeness counts.
ALTER TABLE "MusicVideo" ADD COLUMN "musicbrainzRecordingId" TEXT;
ALTER TABLE "MusicVideo" ADD COLUMN "musicbrainzAudioRecordingId" TEXT;
ALTER TABLE "MusicVideo" ADD COLUMN "catalogKind" TEXT NOT NULL DEFAULT 'official';
UPDATE "MusicVideo" SET "catalogKind" = 'inventory', "monitored" = 0 WHERE "imvdbVideoId" IS NULL;
CREATE UNIQUE INDEX "MusicVideo_musicbrainzRecordingId_key" ON "MusicVideo"("musicbrainzRecordingId");

ALTER TABLE "LibraryArtist" ADD COLUMN "musicbrainzArtistId" TEXT;
ALTER TABLE "LibraryArtist" ADD COLUMN "musicbrainzSource" TEXT;

CREATE TABLE "MusicBrainzArtistCandidate" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "artistId" INTEGER NOT NULL,
  "musicbrainzArtistId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortName" TEXT,
  "artistType" TEXT,
  "country" TEXT,
  "disambiguation" TEXT,
  "score" REAL NOT NULL,
  "evidence" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'suggested',
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MusicBrainzArtistCandidate_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MusicBrainzArtistCandidate_artistId_musicbrainzArtistId_key" ON "MusicBrainzArtistCandidate"("artistId", "musicbrainzArtistId");
CREATE INDEX "MusicBrainzArtistCandidate_artistId_status_score_idx" ON "MusicBrainzArtistCandidate"("artistId", "status", "score");
