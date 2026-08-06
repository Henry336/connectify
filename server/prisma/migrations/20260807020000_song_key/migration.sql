-- Identifies "the same song" across different YouTube uploads (official video, lyric
-- video, audio-only, reuploads) so automated Library seeding stops collecting variants.
ALTER TABLE "Track" ADD COLUMN "songKey" TEXT;
CREATE INDEX "Track_roomId_songKey_idx" ON "Track"("roomId", "songKey");
