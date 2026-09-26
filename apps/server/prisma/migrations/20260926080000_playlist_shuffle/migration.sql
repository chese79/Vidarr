ALTER TABLE "Playlist" ADD COLUMN "sortMode" TEXT NOT NULL DEFAULT 'artist_title';
ALTER TABLE "Playlist" ADD COLUMN "shuffleSeed" INTEGER;
