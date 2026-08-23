-- CreateTable
CREATE TABLE "LibraryConnector" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "authToken" TEXT,
    "username" TEXT,
    "password" TEXT,
    "musicLibraryId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" DATETIME,
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT
);

-- CreateTable
CREATE TABLE "LibraryArtist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connectorId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "genre" TEXT,
    "playCount" INTEGER,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryArtist_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationProviderConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKey" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "accessToken" TEXT,
    "tokenExpiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistName" TEXT NOT NULL,
    "normalizedArtistName" TEXT NOT NULL,
    "mbid" TEXT,
    "aggregateScore" REAL NOT NULL,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "dateFound" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedArtistId" INTEGER
);

-- CreateTable
CREATE TABLE "RecommendationSourceHit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recommendationId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "seedArtistName" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "RecommendationSourceHit_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryArtist_connectorId_externalId_key" ON "LibraryArtist"("connectorId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationProviderConfig_provider_key" ON "RecommendationProviderConfig"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_normalizedArtistName_key" ON "Recommendation"("normalizedArtistName");
