CREATE TABLE "VideoReviewCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "artistId" INTEGER,
    "artistName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "filePath" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoReviewCandidate_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VideoReviewCandidate_source_externalId_key" ON "VideoReviewCandidate"("source", "externalId");
CREATE INDEX "VideoReviewCandidate_decision_artistId_idx" ON "VideoReviewCandidate"("decision", "artistId");
