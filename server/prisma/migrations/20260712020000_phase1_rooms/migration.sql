ALTER TABLE "Room" ADD COLUMN "autopilotEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Track" ADD COLUMN "addedByUserId" TEXT;
ALTER TABLE "Track" ADD COLUMN "playedAt" TIMESTAMP(3);

CREATE TABLE "Moment" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "position" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Moment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Moment_roomId_createdAt_idx" ON "Moment"("roomId", "createdAt");
CREATE INDEX "Moment_trackId_position_idx" ON "Moment"("trackId", "position");
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
