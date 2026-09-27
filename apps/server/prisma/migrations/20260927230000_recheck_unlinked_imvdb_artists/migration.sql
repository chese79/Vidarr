-- Re-evaluate artists checked before public-name IMVDb discovery was added.
UPDATE "Artist"
SET "videoInventoryCheckedAt" = NULL, "videoInventoryError" = NULL
WHERE "musicbrainzMatchStatus" = 'confirmed' AND "imvdbArtistId" IS NULL;
