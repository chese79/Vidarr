-- CreateTable
CREATE TABLE "Artist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sortName" TEXT NOT NULL,
    "imvdbArtistId" TEXT,
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "rootFolderId" INTEGER NOT NULL,
    "qualityProfileId" INTEGER NOT NULL,
    "posterUrl" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artist_rootFolderId_fkey" FOREIGN KEY ("rootFolderId") REFERENCES "RootFolder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Artist_qualityProfileId_fkey" FOREIGN KEY ("qualityProfileId") REFERENCES "QualityProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicVideo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artistId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "imvdbVideoId" TEXT,
    "youtubeVideoId" TEXT,
    "releaseYear" INTEGER,
    "director" TEXT,
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "hasFile" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailUrl" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicVideo_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicVideoFile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "qualityId" INTEGER,
    "sizeBytes" BIGINT NOT NULL,
    "mediaInfo" TEXT,
    "originalFilename" TEXT NOT NULL,
    "dateAdded" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicVideoFile_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MusicVideoFile_qualityId_fkey" FOREIGN KEY ("qualityId") REFERENCES "Quality" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Quality" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "resolution" INTEGER,
    "weight" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "QualityProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "cutoffQualityId" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "QualityProfileItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "qualityProfileId" INTEGER NOT NULL,
    "qualityId" INTEGER NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "QualityProfileItem_qualityProfileId_fkey" FOREIGN KEY ("qualityProfileId") REFERENCES "QualityProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualityProfileItem_qualityId_fkey" FOREIGN KEY ("qualityId") REFERENCES "Quality" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RootFolder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "path" TEXT NOT NULL,
    "freeSpaceBytes" BIGINT,
    "accessible" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Indexer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "implementation" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT,
    "categories" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 25,
    "supportsRss" BOOLEAN NOT NULL DEFAULT true,
    "supportsSearch" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "DownloadClient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "implementation" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "apiKey" TEXT,
    "category" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 25
);

-- CreateTable
CREATE TABLE "YoutubeSource" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "artistId" INTEGER NOT NULL,
    "monitored" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" DATETIME,
    "qualitySelector" TEXT NOT NULL DEFAULT 'bestvideo[height<=1080]+bestaudio',
    CONSTRAINT "YoutubeSource_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadQueueItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "downloadClientId" INTEGER,
    "status" TEXT NOT NULL,
    "progress" REAL NOT NULL DEFAULT 0,
    "outputPath" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DownloadQueueItem_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DownloadQueueItem_downloadClientId_fkey" FOREIGN KEY ("downloadClientId") REFERENCES "DownloadClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "History" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "musicVideoId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT,
    CONSTRAINT "History_musicVideoId_fkey" FOREIGN KEY ("musicVideoId") REFERENCES "MusicVideo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "intervalMs" INTEGER NOT NULL,
    "lastRunAt" DATETIME,
    "lastResult" TEXT,
    "lastError" TEXT
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "namingFormat" TEXT NOT NULL DEFAULT '{Artist Name}/{Artist Name} - {Video Title} ({Year}) [{Quality}]',
    "transferMode" TEXT NOT NULL DEFAULT 'hardlink',
    "minFreeSpaceMb" INTEGER NOT NULL DEFAULT 1024
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TagOnArtist" (
    "artistId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    PRIMARY KEY ("artistId", "tagId"),
    CONSTRAINT "TagOnArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TagOnArtist_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_imvdbArtistId_key" ON "Artist"("imvdbArtistId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicVideo_imvdbVideoId_key" ON "MusicVideo"("imvdbVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicVideo_youtubeVideoId_key" ON "MusicVideo"("youtubeVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "MusicVideo_artistId_normalizedTitle_key" ON "MusicVideo"("artistId", "normalizedTitle");

-- CreateIndex
CREATE UNIQUE INDEX "MusicVideoFile_musicVideoId_key" ON "MusicVideoFile"("musicVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "Quality_name_key" ON "Quality"("name");

-- CreateIndex
CREATE UNIQUE INDEX "QualityProfile_name_key" ON "QualityProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "QualityProfileItem_qualityProfileId_qualityId_key" ON "QualityProfileItem"("qualityProfileId", "qualityId");

-- CreateIndex
CREATE UNIQUE INDEX "RootFolder_path_key" ON "RootFolder"("path");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledTask_name_key" ON "ScheduledTask"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
