-- Smart Autoplay leans Fresh by default; hosts can slide back toward Familiar.
ALTER TABLE "Room" ALTER COLUMN "autoplayFreshness" SET DEFAULT 80;
UPDATE "Room" SET "autoplayFreshness" = 80 WHERE "autoplayFreshness" = 30;

-- Paginate deeper into each seed query instead of re-fetching page one every run.
ALTER TABLE "LibrarySeed" ADD COLUMN "pageToken" TEXT;
ALTER TABLE "LibrarySeed" ADD COLUMN "pagesFetched" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LibrarySeed" ADD COLUMN "exhausted" BOOLEAN NOT NULL DEFAULT false;
