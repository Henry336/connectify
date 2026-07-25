ALTER TABLE "ChatMessage" ADD COLUMN "replyToId" TEXT;

CREATE TABLE "RoomOperation" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RoomOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");
CREATE INDEX "RoomOperation_roomId_createdAt_idx" ON "RoomOperation"("roomId", "createdAt");
CREATE INDEX "RoomOperation_createdAt_idx" ON "RoomOperation"("createdAt");

ALTER TABLE "ChatMessage"
ADD CONSTRAINT "ChatMessage_replyToId_fkey"
FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RoomOperation"
ADD CONSTRAINT "RoomOperation_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
