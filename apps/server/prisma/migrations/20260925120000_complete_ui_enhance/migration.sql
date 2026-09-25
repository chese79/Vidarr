ALTER TABLE "Artist" ADD COLUMN "metadataRefreshedAt" DATETIME;
ALTER TABLE "Artist" ADD COLUMN "reconciledAt" DATETIME;

ALTER TABLE "MusicVideo" ADD COLUMN "durationSeconds" INTEGER;
ALTER TABLE "MusicVideo" ADD COLUMN "catalogStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "MusicVideo" ADD COLUMN "lastSeenAt" DATETIME;
ALTER TABLE "MusicVideo" ADD COLUMN "removedAt" DATETIME;
ALTER TABLE "MusicVideo" ADD COLUMN "awaitingServerScanAt" DATETIME;

ALTER TABLE "LibraryVideo" ADD COLUMN "durationSeconds" INTEGER;

ALTER TABLE "LibraryConnector" ADD COLUMN "syncRunning" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LibraryConnector" ADD COLUMN "syncProcessed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LibraryConnector" ADD COLUMN "syncTotal" INTEGER;

ALTER TABLE "RootFolder" ADD COLUMN "targetConnectorId" INTEGER REFERENCES "LibraryConnector"("id") ON DELETE SET NULL;

CREATE TABLE "ArtistSource" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "artistId" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT,
  "origin" TEXT NOT NULL,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArtistSource_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ArtistSource_artistId_provider_origin_key" ON "ArtistSource"("artistId", "provider", "origin");

CREATE TABLE "AcquisitionSource" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "musicVideoId" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT,
  "url" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "confidence" TEXT NOT NULL,
  "discoveryOrigin" TEXT NOT NULL,
  "accepted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AcquisitionSource_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AcquisitionSource_musicVideoId_provider_url_key" ON "AcquisitionSource"("musicVideoId", "provider", "url");
CREATE INDEX "AcquisitionSource_musicVideoId_authority_confidence_idx" ON "AcquisitionSource"("musicVideoId", "authority", "confidence");
CREATE INDEX "RootFolder_targetConnectorId_idx" ON "RootFolder"("targetConnectorId");
