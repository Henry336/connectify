CREATE TABLE "TrackVote" (
  "id" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackVote_trackId_userId_key" ON "TrackVote"("trackId", "userId");
CREATE INDEX "TrackVote_userId_idx" ON "TrackVote"("userId");
ALTER TABLE "TrackVote" ADD CONSTRAINT "TrackVote_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
