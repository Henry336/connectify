-- Familiar-to-Fresh balance for Smart Autoplay (0 = room favorites only, 100 = mostly fresh finds).
ALTER TABLE "Room" ADD COLUMN "autoplayFreshness" INTEGER NOT NULL DEFAULT 30;

-- Why Smart Autoplay added a track, shown next to the suggestion in the queue.
ALTER TABLE "Track" ADD COLUMN "autoplayReason" TEXT;
