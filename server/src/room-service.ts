import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function roomSnapshot(code: string) {
  const room = await prisma.room.findUnique({
    where: { code: code.toUpperCase() },
    include: { tracks: { orderBy: { position: "asc" } } },
  });
  if (!room) return null;
  return { ...room, serverTime: new Date().toISOString() };
}

export function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export async function normalizePositions(roomId: string, trackIds: string[]) {
  await prisma.$transaction(
    trackIds.map((id, position) => prisma.track.updateMany({ where: { id, roomId }, data: { position } })),
  );
}

export function adjacentTrackId(trackIds: string[], currentTrackId: string, direction: -1 | 1) {
  const currentIndex = trackIds.indexOf(currentTrackId);
  if (currentIndex < 0) return null;
  return trackIds[currentIndex + direction] ?? null;
}

export async function advanceRoom(code: string, expectedTrackId: string, direction: -1 | 1) {
  const room = await prisma.room.findUnique({
    where: { code },
    include: { tracks: { orderBy: { position: "asc" }, select: { id: true } } },
  });
  if (!room || room.currentTrackId !== expectedTrackId) return false;

  const targetId = adjacentTrackId(room.tracks.map((track) => track.id), expectedTrackId, direction);
  const target = targetId ? { id: targetId } : null;
  const updated = await prisma.room.updateMany({
    where: { id: room.id, currentTrackId: expectedTrackId, revision: room.revision },
    data: target
      ? { currentTrackId: target.id, isPlaying: true, playbackPosition: 0, startedAt: new Date(), revision: { increment: 1 } }
      : direction === -1
        ? { isPlaying: true, playbackPosition: 0, startedAt: new Date(), revision: { increment: 1 } }
        : { isPlaying: false, playbackPosition: 0, startedAt: null, revision: { increment: 1 } },
  });
  return updated.count === 1;
}
