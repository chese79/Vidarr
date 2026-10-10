-- Change the fresh-install default while preserving every existing setting.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
  "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "defaultPlaybackConnectorId" INTEGER,
  "namingFormat" TEXT NOT NULL DEFAULT '{Artist Name}/{Video Title} ({Year})/{Artist Name} - {Video Title} ({Year}) [{Quality}]',
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
UPDATE "Settings" SET "namingFormat" = '{Artist Name}/{Video Title} ({Year})/{Artist Name} - {Video Title} ({Year}) [{Quality}]'
WHERE "namingFormat" = '{Artist Name}/{Artist Name} - {Video Title} ({Year}) [{Quality}]';
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
