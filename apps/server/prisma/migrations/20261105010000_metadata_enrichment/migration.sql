CREATE TABLE "MetadataEnrichmentRun" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "connectorId" INTEGER NOT NULL,
 "serverId" TEXT NOT NULL,
 "libraryId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'running',
 "cursor" INTEGER NOT NULL DEFAULT 0,
 "highWaterId" INTEGER NOT NULL,
 "processed" INTEGER NOT NULL DEFAULT 0,
 "updated" INTEGER NOT NULL DEFAULT 0,
 "completeCount" INTEGER NOT NULL DEFAULT 0,
 "reviewCount" INTEGER NOT NULL DEFAULT 0,
 "unknownCount" INTEGER NOT NULL DEFAULT 0,
 "failedCount" INTEGER NOT NULL DEFAULT 0,
 "leaseAt" DATETIME,
 "error" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "MetadataEnrichmentRun_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "LibraryConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "MetadataEnrichmentItem" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "runId" INTEGER NOT NULL,
 "libraryVideoId" INTEGER NOT NULL,
 "externalId" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "artistName" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending',
 "beforeJson" TEXT NOT NULL,
 "proposalJson" TEXT NOT NULL,
 "resultJson" TEXT,
 "changed" BOOLEAN NOT NULL DEFAULT false,
 "error" TEXT,
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "retryAt" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "MetadataEnrichmentItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MetadataEnrichmentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MetadataEnrichmentRun_status_id_idx" ON "MetadataEnrichmentRun"("status", "id");
CREATE INDEX "MetadataEnrichmentRun_connectorId_status_idx" ON "MetadataEnrichmentRun"("connectorId", "status");
CREATE UNIQUE INDEX "MetadataEnrichmentItem_runId_externalId_key" ON "MetadataEnrichmentItem"("runId", "externalId");
CREATE INDEX "MetadataEnrichmentItem_runId_status_id_idx" ON "MetadataEnrichmentItem"("runId", "status", "id");
CREATE INDEX "MetadataEnrichmentItem_libraryVideoId_idx" ON "MetadataEnrichmentItem"("libraryVideoId");
