ALTER TABLE "LibraryConnector" ADD COLUMN "userId" TEXT;

-- Older releases stored the Jellyfin user id in musicLibraryId. Preserve it
-- while freeing musicLibraryId to hold the actual user-selected music library.
UPDATE "LibraryConnector"
SET "userId" = "musicLibraryId", "musicLibraryId" = NULL
WHERE "type" = 'jellyfin' AND "musicLibraryId" IS NOT NULL;
