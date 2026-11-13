CREATE INDEX "LibraryVideo_musicVideoId_idx" ON "LibraryVideo"("musicVideoId");
CREATE INDEX "MusicVideo_artistId_catalogKind_idx" ON "MusicVideo"("artistId", "catalogKind");
