-- Failed genre lookups retain their candidates and successful-refresh timestamp.
-- Track attempts separately so retries cannot starve the remaining backfill.
ALTER TABLE "Artist" ADD COLUMN "genresRefreshAttemptedAt" DATETIME;
