-- Change the fresh-install default while preserving every existing setting.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
  "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "defaultPlaybackConnectorId" INTEGER,
  "namingFormat" TEXT NOT NULL DEFAULT '{Artist Name}/{Artist Name} - {Video Title} ({Year}) [{Quality}]',
  "transferMode" TEXT NOT NULL DEFAULT 'move',
  "minFreeSpaceMb" INTEGER NOT NULL DEFAULT 1024,
  "imvdbApiKey" TEXT,
  "apiKey" TEXT,
  "apiKeyGeneratedAt" DATETIME,
  "apiKeyFirstUsedAt" DATETIME,
  "googleClientId" TEXT,
  "googleClientSecret" TEXT,
  "googleAllowedEmail" TEXT,
  "adminUsername" TEXT,
  "adminPasswordHash" TEXT
);
INSERT INTO "new_Settings" ("id", "defaultPlaybackConnectorId", "namingFormat", "transferMode", "minFreeSpaceMb", "imvdbApiKey", "apiKey", "apiKeyGeneratedAt", "apiKeyFirstUsedAt", "googleClientId", "googleClientSecret", "googleAllowedEmail", "adminUsername", "adminPasswordHash")
SELECT "id", "defaultPlaybackConnectorId", "namingFormat", "transferMode", "minFreeSpaceMb", "imvdbApiKey", "apiKey", "apiKeyGeneratedAt", "apiKeyFirstUsedAt", "googleClientId", "googleClientSecret", "googleAllowedEmail", "adminUsername", "adminPasswordHash" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
-- Existing managed files without confirmed server ownership need delivery review.
UPDATE "MusicVideo" SET "awaitingServerScanAt" = CURRENT_TIMESTAMP
WHERE "hasFile" = 1 AND "awaitingServerScanAt" IS NULL AND NOT EXISTS (
  SELECT 1 FROM "LibraryVideo" lv JOIN "LibraryConnector" lc ON lc."id" = lv."connectorId"
  WHERE lv."musicVideoId" = "MusicVideo"."id" AND lv."available" = 1
    AND lv."matchConfidence" IS NULL AND lc."enabled" = 1
);
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
