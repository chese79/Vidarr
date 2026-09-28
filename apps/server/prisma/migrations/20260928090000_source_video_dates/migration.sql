ALTER TABLE "MusicVideo" ADD COLUMN "sourcePublishedAt" DATETIME;

ALTER TABLE "VideoReviewCandidate" ADD COLUMN "sourcePublishedAt" DATETIME;
ALTER TABLE "VideoReviewCandidate" ADD COLUMN "firstSeenAt" DATETIME;
ALTER TABLE "VideoReviewCandidate" ADD COLUMN "lastSeenAt" DATETIME;

UPDATE "VideoReviewCandidate" SET "firstSeenAt" = "createdAt";
