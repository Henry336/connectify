import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { z } from "zod";
import { createRoomCode, normalizePositions, prisma, roomSnapshot } from "./room-service.js";
import { resolveTrack } from "./youtube.js";

const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map((v) => v.trim());
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins, credentials: true } });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "32kb" }));

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.get("/health", (_req, res) => res.json({ ok: true, service: "connectify-api" }));

app.post("/api/rooms", asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(48), userId: z.string().min(8).max(80) }).parse(req.body);
  let room = null;
  for (let attempt = 0; attempt < 5 && !room; attempt += 1) {
    try {
      room = await prisma.room.create({ data: { code: createRoomCode(), name: input.name, createdBy: input.userId } });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
    }
  }
  if (!room) return res.status(503).json({ error: "Could not allocate a room code. Try again." });
  res.status(201).json(room);
}));

app.get("/api/rooms/:code", asyncRoute(async (req, res) => {
  const room = await roomSnapshot(String(req.params.code));
  if (!room) return res.status(404).json({ error: "Room not found." });
  res.json(room);
}));

app.post("/api/rooms/:code/tracks", asyncRoute(async (req, res) => {
  const input = z.object({ url: z.string().url(), addedBy: z.string().trim().min(1).max(40) }).parse(req.body);
  const room = await prisma.room.findUnique({ where: { code: String(req.params.code).toUpperCase() }, include: { _count: { select: { tracks: true } } } });
  if (!room) return res.status(404).json({ error: "Room not found." });
  if (room._count.tracks >= 100) return res.status(409).json({ error: "This queue is full." });

  const metadata = await resolveTrack(input.url);
  const track = await prisma.track.create({ data: { roomId: room.id, position: room._count.tracks, addedBy: input.addedBy, ...metadata } });
  if (!room.currentTrackId) {
    await prisma.room.update({ where: { id: room.id }, data: { currentTrackId: track.id, playbackPosition: 0, revision: { increment: 1 } } });
  }
  const snapshot = await roomSnapshot(room.code);
  io.to(room.code).emit("room:snapshot", snapshot);
  res.status(201).json(track);
}));

const presence = new Map<string, Map<string, { userId: string; name: string; avatar: string }>>();
const emitPresence = (code: string) => io.to(code).emit("room:presence", [...(presence.get(code)?.values() ?? [])]);

io.on("connection", (socket) => {
  socket.on("room:join", async (payload, reply = () => undefined) => {
    try {
      const input = z.object({ code: z.string().length(6), userId: z.string().min(8).max(80), name: z.string().trim().min(1).max(30), avatar: z.string().max(4) }).parse(payload);
      const code = input.code.toUpperCase();
      const snapshot = await roomSnapshot(code);
      if (!snapshot) return reply({ ok: false, error: "Room not found." });
      await socket.join(code);
      socket.data = { code, userId: input.userId };
      if (!presence.has(code)) presence.set(code, new Map());
      presence.get(code)!.set(socket.id, { userId: input.userId, name: input.name, avatar: input.avatar });
      emitPresence(code);
      socket.emit("room:snapshot", snapshot);
      reply({ ok: true });
    } catch (error: any) {
      reply({ ok: false, error: error?.message || "Could not join room." });
    }
  });

  socket.on("playback:set", async (payload) => {
    const code = socket.data.code as string | undefined;
    if (!code) return;
    const input = z.object({ isPlaying: z.boolean(), position: z.number().min(0).max(86400), trackId: z.string() }).safeParse(payload);
    if (!input.success) return;
    const room = await prisma.room.findUnique({ where: { code } });
    const track = await prisma.track.findFirst({ where: { id: input.data.trackId, roomId: room?.id } });
    if (!room || !track) return;
    await prisma.room.update({ where: { id: room.id }, data: {
      currentTrackId: track.id,
      isPlaying: input.data.isPlaying,
      playbackPosition: input.data.position,
      startedAt: input.data.isPlaying ? new Date() : null,
      revision: { increment: 1 },
    } });
    io.to(code).emit("room:snapshot", await roomSnapshot(code));
  });

  socket.on("queue:remove", async (payload) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackId: z.string() }).safeParse(payload);
    if (!code || !parsed.success) return;
    const room = await prisma.room.findUnique({ where: { code }, include: { tracks: { orderBy: { position: "asc" } } } });
    if (!room) return;
    const target = room.tracks.find((track) => track.id === parsed.data.trackId);
    if (!target) return;
    const remaining = room.tracks.filter((track) => track.id !== target.id);
    const nextCurrent = room.currentTrackId === target.id ? remaining[0]?.id ?? null : room.currentTrackId;
    await prisma.$transaction([
      prisma.track.delete({ where: { id: target.id } }),
      prisma.room.update({ where: { id: room.id }, data: { currentTrackId: nextCurrent, isPlaying: nextCurrent ? room.isPlaying : false, playbackPosition: room.currentTrackId === target.id ? 0 : room.playbackPosition, startedAt: room.currentTrackId === target.id ? null : room.startedAt, revision: { increment: 1 } } }),
    ]);
    await normalizePositions(room.id, remaining.map((track) => track.id));
    io.to(code).emit("room:snapshot", await roomSnapshot(code));
  });

  socket.on("queue:reorder", async (payload) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackIds: z.array(z.string()).max(100) }).safeParse(payload);
    if (!code || !parsed.success) return;
    const room = await prisma.room.findUnique({ where: { code }, include: { tracks: true } });
    if (!room || room.tracks.length !== parsed.data.trackIds.length || !room.tracks.every((track) => parsed.data.trackIds.includes(track.id))) return;
    await normalizePositions(room.id, parsed.data.trackIds);
    io.to(code).emit("room:snapshot", await roomSnapshot(code));
  });

  socket.on("queue:vote", async (payload) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ trackId: z.string() }).safeParse(payload);
    if (!code || !parsed.success) return;
    const room = await prisma.room.findUnique({ where: { code } });
    if (!room) return;
    await prisma.track.updateMany({ where: { id: parsed.data.trackId, roomId: room.id }, data: { votes: { increment: 1 } } });
    io.to(code).emit("room:snapshot", await roomSnapshot(code));
  });

  socket.on("disconnect", () => {
    const code = socket.data.code as string | undefined;
    if (!code) return;
    presence.get(code)?.delete(socket.id);
    if (presence.get(code)?.size === 0) presence.delete(code);
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

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});
