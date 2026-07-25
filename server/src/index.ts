import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { advanceRoom, createRoomCode, fairQueueOrder, normalizePositions, prisma, roomPlaybackState, roomQueueState, roomSnapshot } from "./room-service.js";
import { addTrackDenial, advanceAllowed, artistAllowed, endedPlaybackAllowed, joinRoomDenial, trackChangeAllowed } from "./room-policy.js";
import { searchConnectifyLibrary, searchYouTube } from "./search-service.js";
import { resolveTrack } from "./youtube.js";

const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map((value) => value.trim());
const partyModeSchema = z.enum(["standard", "pass_aux", "blind_pick", "one_take", "discovery", "watch_party"]);
const themeSchema = z.enum(["violet", "sunset", "ocean", "mono"]);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newHostToken = () => randomBytes(32).toString("base64url");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true, exposedHeaders: ["Server-Timing", "X-Request-Id"] }));
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  const startedAt = performance.now();
  const requestId = randomBytes(6).toString("hex");
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    const duration = performance.now() - startedAt;
    if (duration > 250 || process.env.NODE_ENV !== "production") {
      console.log(JSON.stringify({ type: "http_timing", requestId, method: req.method, path: req.route?.path || req.path, status: res.statusCode, durationMs: Number(duration.toFixed(1)) }));
    }
  });
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (!res.headersSent) {
      const existing = res.getHeader("Server-Timing");
      res.setHeader("Server-Timing", `${existing ? `${existing}, ` : ""}app;dur=${(performance.now() - startedAt).toFixed(1)}`);
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
});

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.get("/health", (_req, res) => res.json({ ok: true, service: "connectify-api" }));
app.get("/ready", asyncRoute(async (_req, res) => {
  const startedAt = performance.now();
  const databaseStartedAt = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  const databaseMs = performance.now() - databaseStartedAt;
  const totalMs = performance.now() - startedAt;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Server-Timing", `db;dur=${databaseMs.toFixed(1)}, ready;dur=${totalMs.toFixed(1)}`);
  res.json({
    ok: true,
    service: "connectify-api",
    databaseMs: Number(databaseMs.toFixed(1)),
    totalMs: Number(totalMs.toFixed(1)),
    region: process.env.RENDER_REGION || process.env.RENDER_SERVICE_NAME,
  });
}));

app.post("/api/rooms", asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(48), userId: z.string().min(8).max(80) }).parse(req.body);
  const hostToken = newHostToken();
  let room = null;
  for (let attempt = 0; attempt < 5 && !room; attempt += 1) {
    try {
      room = await prisma.room.create({ data: { code: createRoomCode(), name: input.name, createdBy: input.userId, hostTokenHash: hashToken(hostToken) } });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
    }
  }
  if (!room) return res.status(503).json({ error: "Could not allocate a room code. Try again." });
  res.status(201).json({ code: room.code, name: room.name, hostToken });
}));

app.get("/api/rooms/:code", asyncRoute(async (req, res) => {
  const room = await roomSnapshot(String(req.params.code));
  if (!room) return res.status(404).json({ error: "Room not found." });
  res.json(room);
}));

app.get("/api/search/local", asyncRoute(async (req, res) => {
  const input = z.object({ q: z.string().trim().min(2).max(100), code: z.string().length(6) }).parse(req.query);
  res.json({ items: await searchConnectifyLibrary(input.q, input.code.toUpperCase()) });
}));

const searchLimits = new Map<string, { count: number; resetAt: number }>();
app.get("/api/search/youtube", asyncRoute(async (req, res) => {
  const input = z.object({ q: z.string().trim().min(2).max(100), pageToken: z.string().max(200).optional() }).parse(req.query);
  const key = req.ip || "unknown";
  const now = Date.now();
  const limit = searchLimits.get(key);
  if (!limit || limit.resetAt <= now) searchLimits.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
  else if (limit.count >= 30) return res.status(429).json({ error: "Too many live searches. Try again later." });
  else limit.count += 1;
  if (!process.env.YOUTUBE_API_KEY) return res.status(503).json({ error: "Live YouTube search is not configured yet.", code: "SEARCH_UNAVAILABLE" });
  try {
    res.json(await searchYouTube(input.q, input.pageToken));
  } catch (error: any) {
    if (error?.status === 403 || error?.status === 429) return res.status(503).json({ error: "YouTube live search is temporarily unavailable. You can still paste a URL.", code: "SEARCH_QUOTA" });
    throw error;
  }
}));

app.post("/api/rooms/:code/tracks", asyncRoute(async (req, res) => {
  const input = z.object({
    url: z.string().url(),
    addedBy: z.string().trim().min(1).max(40),
    userId: z.string().min(8).max(80),
    hostToken: z.string().max(200).optional(),
    placement: z.enum(["last", "next"]).default("last"),
    metadata: z.object({
      providerId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
      title: z.string().trim().min(1).max(300),
      artist: z.string().trim().min(1).max(200),
      thumbnail: z.string().url().nullable(),
      duration: z.number().finite().min(1).max(86400).nullable().optional(),
    }).optional(),
  }).parse(req.body);
  const code = String(req.params.code).toUpperCase();
  const [room, metadata] = await Promise.all([
    prisma.room.findUnique({ where: { code } }),
    resolveTrack(input.url, input.metadata),
  ]);
  if (!room) return res.status(404).json({ error: "Room not found." });
  const isHost = Boolean(input.hostToken && room.hostTokenHash === hashToken(input.hostToken));
  const [member, activeTrackCount, pendingByUser, duplicate, artists, maxPosition] = await Promise.all([
    prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: input.userId } } }),
    prisma.track.count({ where: { roomId: room.id, removedAt: null } }),
    isHost ? Promise.resolve(0) : prisma.track.count({ where: { roomId: room.id, addedByUserId: input.userId, playedAt: null, removedAt: null, ...(room.currentTrackId ? { NOT: { id: room.currentTrackId } } : {}) } }),
    prisma.track.findFirst({ where: { roomId: room.id, providerId: metadata.providerId, removedAt: null }, select: { title: true } }),
    room.partyMode === "discovery" ? prisma.track.findMany({ where: { roomId: room.id }, select: { artist: true } }) : Promise.resolve([]),
    prisma.track.aggregate({ where: { roomId: room.id, removedAt: null }, _max: { position: true } }),
  ]);
  if (activeTrackCount >= 100) return res.status(409).json({ error: "This queue is full." });
  const denial = addTrackDenial({ isLocked: room.isLocked, isReturning: Boolean(member), isHost, isBanned: Boolean(member?.isBanned), guestsCanAdd: room.guestsCanAdd, pending: pendingByUser, limit: room.maxSongsPerUser });
  if (denial) return res.status(403).json({ error: denial });

  if (duplicate) return res.status(409).json({ error: `“${duplicate.title}” is already in this room.` });
  if (!artistAllowed(room.partyMode, artists.map((track) => track.artist), metadata.artist)) return res.status(409).json({ error: `${metadata.artist} has already appeared in Discovery Night.` });
  const playNext = Boolean(room.currentTrackId) && input.placement === "next" && (isHost || room.guestsCanControl);
  const track = await prisma.$transaction(async (tx) => {
    if (playNext) await tx.track.updateMany({ where: { roomId: room.id, removedAt: null }, data: { playNext: false } });
    const created = await tx.track.create({ data: { roomId: room.id, position: (maxPosition._max.position ?? -1) + 1, addedBy: input.addedBy, addedByUserId: input.userId, playNext, ...metadata } });
    await tx.room.update({
      where: { id: room.id },
      data: {
        ...(room.currentTrackId ? {} : { currentTrackId: created.id, playbackPosition: 0 }),
        revision: { increment: 1 },
      },
    });
    return created;
  });
  res.status(201).json(track);
  void emitQueueState(room.code).then(() => scheduleRoomEnd(room.code)).catch((error) => console.error("Queue broadcast failed:", error));
}));

type PresencePerson = { id: string; name: string; avatar: string; role: "host" | "guest" };
const presence = new Map<string, Map<string, PresencePerson>>();
const emitPresence = (code: string) => io.to(code).emit("room:presence", [...(presence.get(code)?.values() ?? [])]);
const emitSnapshot = async (code: string) => io.to(code).emit("room:snapshot", await roomSnapshot(code));
const emitQueueState = async (code: string) => io.to(code).emit("room:queue", await roomQueueState(code));
const safe = (
  nameOrHandler: string | ((...args: any[]) => Promise<void>),
  maybeHandler?: (...args: any[]) => Promise<void>,
) => {
  const name = typeof nameOrHandler === "string" ? nameOrHandler : undefined;
  const handler = typeof nameOrHandler === "string" ? maybeHandler! : nameOrHandler;
  return (...args: any[]) => {
    const startedAt = performance.now();
    void handler(...args).then(() => {
      if (name) console.log(JSON.stringify({ type: "socket_timing", event: name, durationMs: Number((performance.now() - startedAt).toFixed(1)) }));
    }).catch((error) => {
      console.error("Socket event failed:", error);
      const possibleReply = args.at(-1);
      if (typeof possibleReply === "function") possibleReply({ ok: false, error: "The room could not apply that change." });
    });
  };
};
const isHostSocket = (socket: Socket) => socket.data.isHost === true;
const canControl = (socket: Socket) => isHostSocket(socket) || socket.data.guestsCanControl === true;
const endTimers = new Map<string, NodeJS.Timeout>();

async function scheduleRoomEnd(code: string) {
  const previous = endTimers.get(code);
  if (previous) clearTimeout(previous);
  endTimers.delete(code);
  const room = await prisma.room.findUnique({
    where: { code },
    select: {
      currentTrackId: true,
      isPlaying: true,
      playbackPosition: true,
      startedAt: true,
      tracks: { where: { removedAt: null }, select: { id: true, duration: true } },
    },
  });
  if (!room?.currentTrackId || !room.isPlaying || !room.startedAt) return;
  const current = room.tracks.find((track) => track.id === room.currentTrackId);
  if (!current?.duration) return;
  const elapsed = room.playbackPosition + Math.max(0, (Date.now() - room.startedAt.getTime()) / 1000);
  const delay = Math.max(250, (current.duration - elapsed + 0.75) * 1000);
  const timer = setTimeout(() => {
    endTimers.delete(code);
    void advanceRoom(code, current.id, 1).then(async (advanced) => {
      if (!advanced) return;
      await emitQueueState(code);
      await scheduleRoomEnd(code);
    }).catch((error) => console.error("Authoritative room ending failed:", error));
  }, Math.min(delay, 2_147_000_000));
  timer.unref();
  endTimers.set(code, timer);
}

io.on("connection", (socket) => {
  socket.on("room:sync", safe(async (_payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    if (!code) return reply({ ok: false });
    reply({ ok: true, snapshot: await roomSnapshot(code) });
  }));

  socket.on("room:join", safe("room:join", async (payload, reply = () => undefined) => {
    try {
      const input = z.object({ code: z.string().length(6), userId: z.string().min(8).max(80), name: z.string().trim().min(1).max(30), avatar: z.string().max(4), hostToken: z.string().max(200).optional() }).parse(payload);
      const code = input.code.toUpperCase();
      const room = await prisma.room.findUnique({ where: { code }, include: { members: { where: { userId: input.userId }, take: 1 } } });
      if (!room) return reply({ ok: false, error: "Room not found." });
      const existing = room.members[0];
      let issuedHostToken: string | undefined;
      let isHost = Boolean(input.hostToken && room.hostTokenHash === hashToken(input.hostToken));
      if (!room.hostTokenHash && room.createdBy === input.userId) {
        issuedHostToken = newHostToken();
        await prisma.room.update({ where: { id: room.id }, data: { hostTokenHash: hashToken(issuedHostToken) } });
        isHost = true;
      }
      const denial = joinRoomDenial({ isLocked: room.isLocked, isReturning: Boolean(existing), isHost, isBanned: Boolean(existing?.isBanned) });
      if (denial) return reply({ ok: false, error: denial });
      const role = isHost ? "host" : "guest";
      await prisma.roomMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId: input.userId } },
        create: { roomId: room.id, userId: input.userId, name: input.name, avatar: input.avatar, role },
        update: { name: input.name, avatar: input.avatar, role: isHost ? "host" : existing?.role || "guest", lastSeenAt: new Date() },
      });
      await socket.join(code);
      socket.data = {
        code,
        roomId: room.id,
        userId: input.userId,
        name: input.name,
        isHost,
        guestsCanControl: room.guestsCanControl,
        guestsCanAdd: room.guestsCanAdd,
      };
      if (!presence.has(code)) presence.set(code, new Map());
      presence.get(code)!.set(socket.id, { id: socket.id, name: input.name, avatar: input.avatar, role });
      emitPresence(code);
      const [snapshot, votes] = await Promise.all([
        roomSnapshot(code),
        prisma.trackVote.findMany({ where: { userId: input.userId, track: { room: { code } } }, select: { trackId: true } }),
      ]);
      reply({ ok: true, role, hostToken: issuedHostToken, snapshot, votes: votes.map((vote) => vote.trackId) });
      void scheduleRoomEnd(code);
    } catch (error: any) {
      reply({ ok: false, error: error?.message || "Could not join room." });
    }
  }));

  socket.on("playback:set", safe(async (payload, reply = () => undefined) => {
    const startedAt = performance.now();
    const code = socket.data.code as string | undefined;
    if (!code || !canControl(socket)) return reply({ ok: false, error: "Playback control is not allowed." });
    const input = z.object({ isPlaying: z.boolean(), position: z.number().min(0).max(86400), trackId: z.string() }).safeParse(payload);
    if (!input.success) return reply({ ok: false, error: "Invalid playback command." });
    const track = await prisma.track.findFirst({ where: { id: input.data.trackId, removedAt: null, room: { code } }, select: { id: true, roomId: true, room: { select: { currentTrackId: true, partyMode: true } } } });
    if (!track) return reply({ ok: false, error: "Track is no longer available." });
    if (!trackChangeAllowed(track.room.partyMode, track.room.currentTrackId, track.id)) return reply({ ok: false, error: "This party mode blocks that change." });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.room.update({ where: { id: track.roomId }, data: { currentTrackId: track.id, isPlaying: input.data.isPlaying, playbackPosition: input.data.position, startedAt: input.data.isPlaying ? now : null, revision: { increment: 1 } } });
      if (track.room.currentTrackId && track.room.currentTrackId !== track.id) {
        await tx.track.update({ where: { id: track.room.currentTrackId }, data: { playedAt: now } });
        await tx.track.update({ where: { id: track.id }, data: { playedAt: null } });
      }
    });
    const state = await roomPlaybackState(code);
    io.to(code).emit("room:playback", state);
    reply({ ok: true, state });
    void scheduleRoomEnd(code);
    console.log(JSON.stringify({ type: "socket_timing", event: "playback:set", durationMs: Number((performance.now() - startedAt).toFixed(1)) }));
  }));

  socket.on("playback:advance", safe(async (payload, reply = () => undefined) => {
    const startedAt = performance.now();
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackId: z.string(), direction: z.union([z.literal(-1), z.literal(1)]), reason: z.enum(["manual", "ended"]).default("manual") }).safeParse(payload);
    if (!code || !parsed.success) return reply({ ok: false });
    const room = await prisma.room.findUnique({
      where: { code },
      select: { partyMode: true, currentTrackId: true, isPlaying: true, playbackPosition: true, startedAt: true, tracks: { where: { id: parsed.data.trackId }, select: { duration: true } } },
    });
    if (!room || (parsed.data.reason !== "ended" && !canControl(socket))) return reply({ ok: false });
    if (!advanceAllowed(room.partyMode, parsed.data.reason)) return reply({ ok: false });
    if (parsed.data.reason === "ended") {
      if (!endedPlaybackAllowed({
        currentTrackId: room.currentTrackId,
        expectedTrackId: parsed.data.trackId,
        isPlaying: room.isPlaying,
        duration: room.tracks[0]?.duration,
        playbackPosition: room.playbackPosition,
        startedAt: room.startedAt,
      })) return reply({ ok: false, error: "Ignored an early or stale ending report." });
    }
    const advanced = await advanceRoom(code, parsed.data.trackId, parsed.data.direction);
    if (!advanced) return reply({ ok: false });
    const state = await roomQueueState(code);
    io.to(code).emit("room:queue", state);
    reply({ ok: true, state });
    void scheduleRoomEnd(code);
    console.log(JSON.stringify({ type: "socket_timing", event: "playback:advance", durationMs: Number((performance.now() - startedAt).toFixed(1)) }));
  }));

  socket.on("queue:remove", safe("queue:remove", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackId: z.string() }).safeParse(payload);
    if (!code || !parsed.success || !canControl(socket)) return reply({ ok: false });
    const room = await prisma.room.findUnique({ where: { code }, include: { tracks: { where: { removedAt: null }, orderBy: { position: "asc" } } } });
    if (!room || (room.partyMode === "one_take" && room.currentTrackId === parsed.data.trackId)) return reply({ ok: false });
    const target = room.tracks.find((track) => track.id === parsed.data.trackId);
    if (!target) return reply({ ok: false });
    const remaining = room.tracks.filter((track) => track.id !== target.id);
    const nextCurrent = room.currentTrackId === target.id ? fairQueueOrder(remaining, null)[0] ?? null : room.currentTrackId;
    await prisma.$transaction([
      prisma.track.update({ where: { id: target.id }, data: { removedAt: new Date(), removedBy: socket.data.userId as string, playNext: false } }),
      prisma.room.update({ where: { id: room.id }, data: { currentTrackId: nextCurrent, isPlaying: nextCurrent ? room.isPlaying : false, playbackPosition: room.currentTrackId === target.id ? 0 : room.playbackPosition, startedAt: room.currentTrackId === target.id ? (nextCurrent && room.isPlaying ? new Date() : null) : room.startedAt, revision: { increment: 1 } } }),
    ]);
    await normalizePositions(room.id, remaining.map((track) => track.id));
    socket.emit("queue:removed", { trackId: target.id, title: target.title });
    const state = await roomQueueState(code);
    io.to(code).emit("room:queue", state);
    reply({ ok: true, state });
    void scheduleRoomEnd(code);
  }));

  socket.on("queue:undo", safe(async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackId: z.string() }).safeParse(payload);
    if (!code || !parsed.success || !canControl(socket)) return reply({ ok: false });
    const room = await prisma.room.findUnique({ where: { code }, select: { id: true, currentTrackId: true } });
    if (!room) return reply({ ok: false });
    const maxPosition = await prisma.track.aggregate({ where: { roomId: room.id, removedAt: null }, _max: { position: true } });
    const restored = await prisma.track.updateMany({ where: { id: parsed.data.trackId, roomId: room.id, removedAt: { not: null } }, data: { removedAt: null, removedBy: null, position: (maxPosition._max.position ?? -1) + 1 } });
    if (!restored.count) return reply({ ok: false });
    await prisma.room.update({
      where: { id: room.id },
      data: { ...(room.currentTrackId ? {} : { currentTrackId: parsed.data.trackId }), revision: { increment: 1 } },
    });
    const state = await roomQueueState(code);
    reply({ ok: true, state });
    io.to(code).emit("room:queue", state);
    void scheduleRoomEnd(code);
  }));

  socket.on("queue:reorder", safe("queue:reorder", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackIds: z.array(z.string()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length) }).safeParse(payload);
    if (!code || !parsed.success || !canControl(socket)) return reply({ ok: false });
    const room = await prisma.room.findUnique({ where: { code }, include: { tracks: { where: { removedAt: null } } } });
    if (!room || !parsed.data.trackIds.every((id) => room.tracks.some((track) => track.id === id))) return reply({ ok: false });
    const untouchedIds = room.tracks.filter((track) => !parsed.data.trackIds.includes(track.id)).sort((a, b) => a.position - b.position).map((track) => track.id);
    await normalizePositions(room.id, [...untouchedIds, ...parsed.data.trackIds]);
    await prisma.room.update({ where: { id: room.id }, data: { revision: { increment: 1 } } });
    const state = await roomQueueState(code);
    io.to(code).emit("room:queue", state);
    reply({ ok: true, state });
  }));

  socket.on("queue:vote", safe("queue:vote", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ trackId: z.string() }).safeParse(payload);
    if (!code || !userId || !parsed.success) return reply({ ok: false });
    const track = await prisma.track.findFirst({ where: { id: parsed.data.trackId, removedAt: null, room: { code } }, select: { id: true } });
    if (!track) return reply({ ok: false });
    try {
      const [, updated] = await prisma.$transaction([prisma.trackVote.create({ data: { trackId: track.id, userId } }), prisma.track.update({ where: { id: track.id }, data: { votes: { increment: 1 } } })]);
      io.to(code).emit("queue:vote-updated", { trackId: track.id, votes: updated.votes });
    } catch (error: any) {
      if (error?.code === "P2002") return reply({ ok: true, alreadyVoted: true });
      throw error;
    }
    reply({ ok: true, alreadyVoted: false });
  }));

  socket.on("track:duration", safe(async (payload) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackId: z.string(), duration: z.number().finite().min(1).max(86400) }).safeParse(payload);
    if (!code || !parsed.success) return;
    const updated = await prisma.track.updateMany({ where: { id: parsed.data.trackId, room: { code }, removedAt: null, duration: null }, data: { duration: Math.round(parsed.data.duration) } });
    if (updated.count) {
      io.to(code).emit("track:duration-updated", { trackId: parsed.data.trackId, duration: Math.round(parsed.data.duration) });
      void scheduleRoomEnd(code);
    }
  }));

  socket.on("room:settings", safe("room:settings", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    if (!code || !isHostSocket(socket)) return reply({ ok: false, error: "Host access required." });
    const parsed = z.object({
      autopilotEnabled: z.boolean().optional(), partyMode: partyModeSchema.optional(), theme: themeSchema.optional(),
      isLocked: z.boolean().optional(), guestsCanControl: z.boolean().optional(), guestsCanAdd: z.boolean().optional(), maxSongsPerUser: z.number().int().min(1).max(20).optional(), discoverable: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0).safeParse(payload);
    if (!parsed.success) return reply({ ok: false, error: "Invalid room setting." });
    await prisma.room.update({ where: { code }, data: { ...parsed.data, revision: { increment: 1 } } });
    if (parsed.data.guestsCanControl !== undefined || parsed.data.guestsCanAdd !== undefined) {
      for (const target of await io.in(code).fetchSockets()) {
        if (parsed.data.guestsCanControl !== undefined) target.data.guestsCanControl = parsed.data.guestsCanControl;
        if (parsed.data.guestsCanAdd !== undefined) target.data.guestsCanAdd = parsed.data.guestsCanAdd;
      }
    }
    reply({ ok: true });
    const state = await prisma.room.findUnique({ where: { code }, select: { revision: true, autopilotEnabled: true, partyMode: true, theme: true, isLocked: true, guestsCanControl: true, guestsCanAdd: true, maxSongsPerUser: true, discoverable: true } });
    io.to(code).emit("room:settings-patch", state);
  }));

  socket.on("room:kick", safe(async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ memberId: z.string() }).safeParse(payload);
    if (!code || !isHostSocket(socket) || !parsed.success) return reply({ ok: false });
    const member = await prisma.roomMember.findFirst({ where: { id: parsed.data.memberId, room: { code }, role: { not: "host" } } });
    if (!member) return reply({ ok: false });
    await prisma.roomMember.update({ where: { id: member.id }, data: { isBanned: true } });
    for (const target of await io.in(code).fetchSockets()) {
      if (target.data.userId === member.userId) { target.emit("room:kicked"); target.disconnect(true); }
    }
    reply({ ok: true });
    await emitSnapshot(code);
  }));

  socket.on("queue:clear", safe(async (_payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    if (!code || !isHostSocket(socket)) return reply({ ok: false });
    const room = await prisma.room.findUnique({ where: { code }, select: { id: true } });
    if (!room) return reply({ ok: false });
    await prisma.$transaction([prisma.track.deleteMany({ where: { roomId: room.id } }), prisma.room.update({ where: { id: room.id }, data: { currentTrackId: null, isPlaying: false, playbackPosition: 0, startedAt: null, revision: { increment: 1 } } })]);
    const state = await roomQueueState(code);
    reply({ ok: true, state });
    io.to(code).emit("room:queue", state);
    void scheduleRoomEnd(code);
  }));

  socket.on("room:react", safe("room:react", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ trackId: z.string(), emoji: z.enum(["🔥", "💜", "🥹", "🕺", "✨"]), position: z.number().min(0).max(86400) }).safeParse(payload);
    if (!code || !userId || !parsed.success) return reply({ ok: false });
    if (Date.now() - Number(socket.data.lastMomentAt || 0) < 500) return reply({ ok: false, error: "Slow down a little." });
    const person = presence.get(code)?.get(socket.id);
    const room = await prisma.room.findUnique({ where: { code }, select: { id: true, currentTrackId: true } });
    if (!room || room.currentTrackId !== parsed.data.trackId || !person) return reply({ ok: false });
    socket.data.lastMomentAt = Date.now();
    const moment = await prisma.moment.create({ data: { roomId: room.id, trackId: parsed.data.trackId, userId, name: person.name, avatar: person.avatar, emoji: parsed.data.emoji, position: parsed.data.position } });
    io.to(code).emit("room:moment", moment);
    reply({ ok: true });
  }));

  socket.on("room:chat", safe(async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ body: z.string().trim().min(1).max(300), spoiler: z.boolean().default(false), trackId: z.string().nullable(), position: z.number().min(0).max(86400).nullable() }).safeParse(payload);
    if (!code || !userId || !parsed.success) return reply({ ok: false });
    if (Date.now() - Number(socket.data.lastChatAt || 0) < 700) return reply({ ok: false, error: "Slow down a little." });
    const person = presence.get(code)?.get(socket.id);
    const room = await prisma.room.findUnique({ where: { code }, select: { id: true, partyMode: true, currentTrackId: true } });
    if (!room || room.partyMode !== "watch_party" || !person) return reply({ ok: false });
    const trackId = parsed.data.trackId === room.currentTrackId ? parsed.data.trackId : null;
    socket.data.lastChatAt = Date.now();
    const message = await prisma.chatMessage.create({ data: { roomId: room.id, trackId, userId, name: person.name, avatar: person.avatar, body: parsed.data.body, position: trackId ? parsed.data.position : null, spoiler: parsed.data.spoiler } });
    io.to(code).emit("room:chat", message);
    reply({ ok: true });
  }));

  socket.on("disconnect", () => {
    const code = socket.data.code as string | undefined;
    if (!code) return;
    presence.get(code)?.delete(socket.id);
    if (presence.get(code)?.size === 0) {
      presence.delete(code);
      const timer = endTimers.get(code);
      if (timer) clearTimeout(timer);
      endTimers.delete(code);
    }
    emitPresence(code);
  });
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || "Invalid request." });
  if (error?.message?.startsWith("Paste a valid")) return res.status(400).json({ error: error.message });
  res.status(500).json({ error: "Something went wrong." });
});

server.listen(port, () => console.log(`Connectify API listening on ${port}`));
process.on("SIGTERM", async () => { await prisma.$disconnect(); server.close(() => process.exit(0)); });
