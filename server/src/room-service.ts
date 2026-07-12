import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export type FairTrack = {
  id: string;
  addedBy: string;
  addedByUserId?: string | null;
  position: number;
  votes: number;
  playedAt?: Date | string | null;
  playNext?: boolean;
};

const contributorKey = (track: FairTrack) => track.addedByUserId || `name:${track.addedBy.toLowerCase()}`;

export function fairQueueOrder(tracks: FairTrack[], currentTrackId: string | null) {
  const current = tracks.find((track) => track.id === currentTrackId);
  const currentContributor = current ? contributorKey(current) : null;
  const pending = tracks.filter((track) => track.id !== currentTrackId && !track.playedAt);
  const pinned = pending.filter((track) => track.playNext).sort((a, b) => a.position - b.position);
  const regular = pending.filter((track) => !track.playNext);
  const groups = new Map<string, FairTrack[]>();

  for (const track of regular) {
    const key = contributorKey(track);
    const group = groups.get(key) || [];
    group.push(track);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((a, b) => b.votes - a.votes || a.position - b.position);

  const contributorOrder = [...groups.entries()].sort(([keyA, tracksA], [keyB, tracksB]) => {
    if (keyA === currentContributor && keyB !== currentContributor) return 1;
    if (keyB === currentContributor && keyA !== currentContributor) return -1;
    return Math.min(...tracksA.map((track) => track.position)) - Math.min(...tracksB.map((track) => track.position));
  });
  const result: string[] = pinned.map((track) => track.id);
  let round = 0;
  while (result.length < pending.length) {
    for (const [, group] of contributorOrder) if (group[round]) result.push(group[round].id);
    round += 1;
  }
  return result;
}

export async function roomSnapshot(code: string) {
  const room = await prisma.room.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      tracks: { where: { removedAt: null }, orderBy: { position: "asc" } },
      moments: { orderBy: { createdAt: "desc" }, take: 60 },
      members: { where: { isBanned: false }, orderBy: { lastSeenAt: "desc" }, select: { id: true, name: true, avatar: true, role: true, joinedAt: true, lastSeenAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!room) return null;
  const queueOrder = [room.currentTrackId, ...fairQueueOrder(room.tracks, room.currentTrackId)].filter(Boolean);
  const { createdBy: _createdBy, hostTokenHash: _hostTokenHash, ...publicRoom } = room;
  return { ...publicRoom, moments: room.moments.reverse(), messages: room.messages.reverse(), queueOrder, serverTime: new Date().toISOString() };
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

export async function advanceRoom(code: string, expectedTrackId: string, direction: -1 | 1) {
  const room = await prisma.room.findUnique({
    where: { code },
    include: { tracks: { where: { removedAt: null }, orderBy: { position: "asc" } } },
  });
  if (!room || room.currentTrackId !== expectedTrackId) return false;

  const current = room.tracks.find((track) => track.id === expectedTrackId);
  if (!current) return false;
  const played = room.tracks.filter((track) => track.id !== current.id && track.playedAt).sort((a, b) => Number(b.playedAt) - Number(a.playedAt));
  let targetId = direction === -1 ? played[0]?.id : fairQueueOrder(room.tracks, current.id)[0];
  let resetCycle = false;
  if (direction === 1 && !targetId && room.autopilotEnabled) {
    resetCycle = true;
    targetId = fairQueueOrder(room.tracks.map((track) => ({ ...track, playedAt: null })), current.id)[0] || current.id;
  }
  if (direction === -1 && !targetId) targetId = current.id;

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.room.updateMany({
      where: { id: room.id, currentTrackId: expectedTrackId, revision: room.revision },
      data: targetId
        ? { currentTrackId: targetId, isPlaying: true, playbackPosition: 0, startedAt: now, revision: { increment: 1 } }
        : { isPlaying: false, playbackPosition: 0, startedAt: null, revision: { increment: 1 } },
    });
    if (updated.count !== 1) return false;
    if (resetCycle) await tx.track.updateMany({ where: { roomId: room.id, removedAt: null }, data: { playedAt: null } });
    if (targetId && targetId !== current.id) {
      if (direction === 1) await tx.track.update({ where: { id: current.id }, data: { playedAt: now } });
      await tx.track.update({ where: { id: targetId }, data: { playedAt: null } });
      await tx.track.update({ where: { id: targetId }, data: { playNext: false } });
    } else if (!targetId) {
      await tx.track.update({ where: { id: current.id }, data: { playedAt: now } });
    }
    return true;
  });
}
