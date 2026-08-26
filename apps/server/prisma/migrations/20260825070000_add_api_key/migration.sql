-- AlterTable: Settings gains apiKey — vidarr's own authentication key,
-- required on every /api/v1/* request except /health. Generated on first
-- boot (see pipeline/auth.ts) if not already present.
ALTER TABLE "Settings" ADD COLUMN "apiKey" TEXT;
