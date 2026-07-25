ALTER TABLE "Room"
ADD COLUMN "maxParticipants" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN "chatSlowMode" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "RoomActivity" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomActivity_roomId_createdAt_idx" ON "RoomActivity"("roomId", "createdAt");

ALTER TABLE "RoomActivity"
ADD CONSTRAINT "RoomActivity_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
