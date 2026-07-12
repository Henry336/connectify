ALTER TABLE "Room" ADD COLUMN "hostTokenHash" TEXT;
ALTER TABLE "Room" ADD COLUMN "partyMode" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "Room" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'violet';
ALTER TABLE "Room" ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Room" ADD COLUMN "guestsCanControl" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Room" ADD COLUMN "guestsCanAdd" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Room" ADD COLUMN "maxSongsPerUser" INTEGER NOT NULL DEFAULT 5;

CREATE TABLE "RoomMember" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'guest',
  "isBanned" BOOLEAN NOT NULL DEFAULT false,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomMember_roomId_userId_key" ON "RoomMember"("roomId", "userId");
CREATE INDEX "RoomMember_roomId_lastSeenAt_idx" ON "RoomMember"("roomId", "lastSeenAt");
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
