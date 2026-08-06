import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});

prisma.$on("query", (event) => {
  if (process.env.NODE_ENV !== "production" && process.env.DB_TIMINGS !== "all") return;
  if (event.duration < 50 && process.env.DB_TIMINGS !== "all") return;
  const operation = event.query.trim().split(/\s+/, 1)[0]?.toUpperCase() || "QUERY";
  console.log(JSON.stringify({
    type: "db_timing",
    operation,
    target: event.target,
    durationMs: event.duration,
  }));
});

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
      tracks: { where: { removedAt: null, playedAt: null }, orderBy: { position: "asc" } },
      moments: { orderBy: { createdAt: "desc" }, take: 30 },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 31,
        include: { replyTo: { select: { id: true, name: true, body: true, spoiler: true } } },
      },
      _count: {
        select: {
          messages: true,
          members: { where: { isBanned: false } },
        },
      },
    },
  });
  if (!room) return null;
  const queueOrder = [room.currentTrackId, ...fairQueueOrder(room.tracks, room.currentTrackId)].filter(Boolean);
  const hasMoreMessages = room.messages.length > 30;
  const messages = room.messages.slice(0, 30).reverse();
  const { createdBy: _createdBy, hostTokenHash: _hostTokenHash, _count, ...publicRoom } = room;
  return {
    ...publicRoom,
    members: [],
    memberCount: _count.members,
    moments: room.moments.reverse(),
    messages,
    hasMoreMessages,
    queueOrder,
    serverTime: new Date().toISOString(),
  };
}

export async function roomMessagesPage(code: string, before?: Date, limit = 30) {
  const room = await prisma.room.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
  if (!room) return null;
  const messages = await prisma.chatMessage.findMany({
    where: { roomId: room.id, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: { replyTo: { select: { id: true, name: true, body: true, spoiler: true } } },
  });
  return { messages: messages.slice(0, limit).reverse(), hasMore: messages.length > limit };
}

export async function roomMembersPage(code: string, cursor?: string, limit = 30) {
  const room = await prisma.room.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
  if (!room) return null;
  const members = await prisma.roomMember.findMany({
    where: { roomId: room.id, isBanned: false },
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, userId: true, name: true, avatar: true, role: true, joinedAt: true, lastSeenAt: true },
  });
  return {
    members: members.slice(0, limit),
    hasMore: members.length > limit,
    cursor: members.length > limit ? members[limit - 1]?.id ?? null : null,
  };
}

export async function roomHistoryPage(code: string, before?: Date, limit = 30) {
  const room = await prisma.room.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
  if (!room) return null;
  const tracks = await prisma.track.findMany({
    where: { roomId: room.id, removedAt: null, playedAt: { not: null, ...(before ? { lt: before } : {}) } },
    orderBy: { playedAt: "desc" },
    take: limit + 1,
  });
  return {
    tracks: tracks.slice(0, limit),
    hasMore: tracks.length > limit,
    cursor: tracks.length > limit ? tracks[limit - 1]?.playedAt?.toISOString() ?? null : null,
  };
}

export async function roomActivityPage(code: string, before?: Date, limit = 30) {
  const room = await prisma.room.findUnique({ where: { code: code.toUpperCase() }, select: { id: true } });
  if (!room) return null;
  const events = await prisma.roomActivity.findMany({
    where: { roomId: room.id, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  return {
    events: events.slice(0, limit),
    hasMore: events.length > limit,
    cursor: events.length > limit ? events[limit - 1]?.createdAt.toISOString() ?? null : null,
  };
}

export async function roomQueueState(code: string) {
  const room = await prisma.room.findUnique({
    where: { code: code.toUpperCase() },
    select: {
      currentTrackId: true,
      isPlaying: true,
      playbackPosition: true,
      startedAt: true,
      revision: true,
      tracks: { where: { removedAt: null, playedAt: null }, orderBy: { position: "asc" } },
    },
  });
  if (!room) return null;
  return {
    currentTrackId: room.currentTrackId,
    isPlaying: room.isPlaying,
    playbackPosition: room.playbackPosition,
    startedAt: room.startedAt,
    revision: room.revision,
    tracks: room.tracks,
    queueOrder: [room.currentTrackId, ...fairQueueOrder(room.tracks, room.currentTrackId)].filter(Boolean),
    serverTime: new Date().toISOString(),
  };
}

export async function roomPlaybackState(code: string) {
  const room = await prisma.room.findUnique({
    where: { code: code.toUpperCase() },
    select: { currentTrackId: true, isPlaying: true, playbackPosition: true, startedAt: true, revision: true },
  });
  return room ? { ...room, serverTime: new Date().toISOString() } : null;
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
    targetId = fairQueueOrder(room.tracks.map((track) => ({ ...track, playedAt: track.autoplayBlocked ? track.playedAt : null })), current.id)[0] || current.id;
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
    if (resetCycle) await tx.track.updateMany({ where: { roomId: room.id, removedAt: null, autoplayBlocked: false }, data: { playedAt: null } });
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

export type RevivalCandidate = {
  id: string;
  artist: string;
  votes: number;
  playedAt?: Date | string | null;
  autoplayBlocked?: boolean;
};

// Chooses which already-played tracks to bring back so the queue keeps a lookahead buffer.
// Prefers crowd favorites and older plays, and spaces out artists that are already upcoming.
export function pickRevivals(candidates: RevivalCandidate[], need: number, upcomingArtists: string[] = []) {
  if (need <= 0) return [];
  const pool = candidates
    .filter((track) => !track.autoplayBlocked && track.playedAt)
    .sort((a, b) => b.votes - a.votes || Number(new Date(a.playedAt as string | Date)) - Number(new Date(b.playedAt as string | Date)));
  const picked: RevivalCandidate[] = [];
  const usedArtists = new Set(upcomingArtists.map((artist) => artist.toLowerCase()));
  for (const track of pool) {
    if (picked.length >= need) break;
    if (usedArtists.has(track.artist.toLowerCase())) continue;
    picked.push(track);
    usedArtists.add(track.artist.toLowerCase());
  }
  // If artist spacing left us short, top up allowing repeats before letting the queue run dry.
  for (const track of pool) {
    if (picked.length >= need) break;
    if (picked.some((item) => item.id === track.id)) continue;
    picked.push(track);
  }
  return picked.map((track) => track.id);
}

// Proactively refills the queue from room history when Smart Autoplay is on and the
// lookahead buffer is running low. Runs off the interaction-critical path (no network),
// bumps the revision optimistically, and returns the revived tracks for broadcast/logging.
export async function refillAutoplay(code: string) {
  const room = await prisma.room.findUnique({
    where: { code },
    select: {
      id: true,
      autopilotEnabled: true,
      autoplayMinBuffer: true,
      currentTrackId: true,
      revision: true,
      tracks: { where: { removedAt: null }, orderBy: { position: "asc" } },
    },
  });
  if (!room || !room.autopilotEnabled || !room.currentTrackId) return null;
  const upcoming = fairQueueOrder(room.tracks, room.currentTrackId);
  const need = room.autoplayMinBuffer - upcoming.length;
  if (need <= 0) return null;
  const byId = new Map(room.tracks.map((track) => [track.id, track]));
  const upcomingArtists = upcoming.map((id) => byId.get(id)?.artist || "").filter(Boolean);
  const candidates = room.tracks.filter((track) => track.id !== room.currentTrackId && track.playedAt && !track.autoplayBlocked);
  const reviveIds = pickRevivals(candidates, need, upcomingArtists);
  if (!reviveIds.length) return null;
  const committed = await prisma.$transaction(async (tx) => {
    const bumped = await tx.room.updateMany({ where: { id: room.id, revision: room.revision }, data: { revision: { increment: 1 } } });
    if (bumped.count !== 1) return false;
    await tx.track.updateMany({ where: { id: { in: reviveIds }, roomId: room.id, autoplayBlocked: false }, data: { playedAt: null } });
    return true;
  });
  if (!committed) return null;
  return reviveIds.map((id) => byId.get(id)!).filter(Boolean);
}

// A read-only look at the autoplay buffer, used to decide whether Smart Discovery should
// prepare fresh suggestions before the familiar revival pass runs.
export async function autoplayOutlook(code: string) {
  const room = await prisma.room.findUnique({
    where: { code },
    select: {
      id: true,
      autopilotEnabled: true,
      autoplayMinBuffer: true,
      autoplayFreshness: true,
      currentTrackId: true,
      tracks: {
        orderBy: { position: "asc" },
        select: { id: true, providerId: true, artist: true, votes: true, position: true, playedAt: true, removedAt: true, playNext: true, addedBy: true, addedByUserId: true },
      },
    },
  });
  if (!room || !room.autopilotEnabled || !room.currentTrackId) return null;
  const active = room.tracks.filter((track) => !track.removedAt);
  const upcoming = fairQueueOrder(active, room.currentTrackId);
  const byId = new Map(active.map((track) => [track.id, track]));
  return {
    roomId: room.id,
    need: Math.max(0, room.autoplayMinBuffer - upcoming.length),
    freshness: room.autoplayFreshness,
    upcomingArtists: upcoming.map((id) => byId.get(id)?.artist || "").filter(Boolean),
    // Anything the room has ever had — queued, played, or removed — is off-limits for suggestions.
    excludeProviderIds: new Set(room.tracks.map((track) => track.providerId)),
    historySignals: active.map(({ artist, votes, playedAt }) => ({ artist, votes, playedAt })),
  };
}

type InsertableItem = { providerId: string; title: string; artist: string; thumbnail: string | null; url: string };
type TrackCredit = { addedBy: string; addedByUserId: string; autoplayReason?: string };

// Shared by DJ Autopilot suggestions and Connectify Library seeding: dedupes against
// whatever the target room already has, bumps its revision optimistically, and inserts
// the rest as normal Track rows crediting the given actor.
async function insertCreditedTracks(code: string, items: InsertableItem[], credit: TrackCredit) {
  if (!items.length) return [];
  const room = await prisma.room.findUnique({ where: { code }, select: { id: true, revision: true } });
  if (!room) return [];
  const [existing, maxPosition] = await Promise.all([
    prisma.track.findMany({ where: { roomId: room.id, providerId: { in: items.map((item) => item.providerId) } }, select: { providerId: true } }),
    prisma.track.aggregate({ where: { roomId: room.id, removedAt: null }, _max: { position: true } }),
  ]);
  const taken = new Set(existing.map((track) => track.providerId));
  const fresh = items.filter((item) => !taken.has(item.providerId));
  if (!fresh.length) return [];
  let position = (maxPosition._max.position ?? -1) + 1;
  return prisma.$transaction(async (tx) => {
    const bumped = await tx.room.updateMany({ where: { id: room.id, revision: room.revision }, data: { revision: { increment: 1 } } });
    if (bumped.count !== 1) return [];
    const created = [];
    for (const item of fresh) {
      created.push(await tx.track.create({
        data: {
          roomId: room.id,
          url: item.url,
          provider: "youtube",
          providerId: item.providerId,
          title: item.title,
          artist: item.artist,
          thumbnail: item.thumbnail,
          position: position++,
          ...credit,
        },
      }));
    }
    return created;
  });
}

// Inserts Smart Discovery suggestions as normal queue rows credited to DJ Autopilot, so
// they inherit voting, removal, reordering, and fair-queue behavior for free.
export function addAutoplayTracks(code: string, items: InsertableItem[], reason: string) {
  return insertCreditedTracks(code, items, { addedBy: "DJ Autopilot", addedByUserId: "autopilot", autoplayReason: reason });
}

// Inserts automated Connectify Library growth results the same way, credited separately
// so they never show the "suggested for this room" tag real rooms use for Autopilot picks.
export function addLibraryTracks(code: string, items: InsertableItem[]) {
  return insertCreditedTracks(code, items, { addedBy: "Connectify Library", addedByUserId: "library-seed" });
}

const LIBRARY_ROOM_CODE = "LIBRAY";

// The permanent, non-joinable system room whose discoverable tracks make up the
// Connectify Library growth pool. Created once, locked, and never assigned a usable
// host token so it can't be claimed or played from the normal join/socket paths.
export async function ensureLibraryRoom() {
  const existing = await prisma.room.findUnique({ where: { code: LIBRARY_ROOM_CODE } });
  if (existing) return existing;
  return prisma.room.create({
    data: {
      code: LIBRARY_ROOM_CODE,
      name: "Connectify Library",
      createdBy: "system",
      hostTokenHash: randomBytes(32).toString("hex"),
      discoverable: true,
      autopilotEnabled: false,
      guestsCanAdd: false,
      guestsCanControl: false,
      isLocked: true,
      maxParticipants: 2,
    },
  });
}
