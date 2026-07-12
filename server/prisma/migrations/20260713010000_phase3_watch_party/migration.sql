ALTER TABLE "Track" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "Track" ADD COLUMN "removedBy" TEXT;
ALTER TABLE "Track" ADD COLUMN "playNext" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "trackId" TEXT,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "position" DOUBLE PRECISION,
  "spoiler" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_roomId_createdAt_idx" ON "ChatMessage"("roomId", "createdAt");
CREATE INDEX "ChatMessage_trackId_position_idx" ON "ChatMessage"("trackId", "position");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
