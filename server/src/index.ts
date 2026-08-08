import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { addAutoplayTracks, addLibraryTracks, advanceRoom, autoplayOutlook, createRoomCode, ensureLibraryRoom, fairQueueOrder, LIBRARY_ROOM_CODE, normalizePositions, prisma, refillAutoplay, roomActivityPage, roomHistoryPage, roomMembersPage, roomMessagesPage, roomQueueState, roomSnapshot } from "./room-service.js";
import { addTrackDenial, advanceAllowed, artistAllowed, endedPlaybackAllowed, joinRoomDenial, publicJoinFailure, trackChangeAllowed } from "./room-policy.js";
import { fetchPlaylistItems, libraryCoverage, searchConnectifyLibrary, searchYouTube, type SearchItem } from "./search-service.js";
import { discoveryQueries, pickDiscovery, splitAutoplay, topArtists } from "./discovery.js";
import { pickSeedTargets, preselectByRotation, SEED_QUERIES } from "./library-seed.js";
import { getPlaylistId, isMixPlaylist, resolveTrack } from "./youtube.js";

const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map((value) => value.trim());
const partyModeSchema = z.enum(["standard", "pass_aux", "blind_pick", "one_take", "discovery", "watch_party"]);
const themeSchema = z.enum(["violet", "sunset", "ocean", "mono"]);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newHostToken = () => randomBytes(32).toString("base64url");
const operationIdSchema = z.string().uuid();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
  httpCompression: { threshold: 4_096 },
  perMessageDeflate: { threshold: 4_096 },
  maxHttpBufferSize: 256_000,
});

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

type VitalSample = { name: string; value: number; rating: string; path: string; at: number };
const vitalSamples: VitalSample[] = [];
app.post("/api/metrics/vitals", asyncRoute(async (req, res) => {
  const sample = z.object({
    name: z.enum(["CLS", "FCP", "INP", "LCP", "TTFB"]),
    value: z.number().finite().min(0).max(600_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    path: z.string().max(120),
  }).parse(req.body);
  vitalSamples.push({ ...sample, path: sample.path.replace(/\/room\/[^/]+/i, "/room/:code"), at: Date.now() });
  if (vitalSamples.length > 1_000) vitalSamples.splice(0, vitalSamples.length - 1_000);
  res.status(202).json({ ok: true });
}));

app.get("/api/metrics/dashboard", (req, res) => {
  const expected = process.env.METRICS_ADMIN_TOKEN;
  if (!expected || req.get("authorization") !== `Bearer ${expected}`) return res.status(404).json({ error: "Not found." });
  const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
  const recent = vitalSamples.filter((sample) => sample.at >= cutoff);
  const groups = new Map<string, VitalSample[]>();
  for (const sample of recent) groups.set(sample.name, [...(groups.get(sample.name) || []), sample]);
  const metrics = [...groups.entries()].map(([name, samples]) => {
    const values = samples.map((sample) => sample.value).sort((a, b) => a - b);
    return {
      name,
      samples: values.length,
      p50: values[Math.floor(values.length * 0.5)] || 0,
      p75: values[Math.floor(values.length * 0.75)] || 0,
      p95: values[Math.floor(values.length * 0.95)] || 0,
      goodPercent: Math.round(samples.filter((sample) => sample.rating === "good").length / samples.length * 100),
    };
  });
  res.json({ windowHours: 24, metrics });
});

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function renderLibraryStatusPage(refreshUrl: string, data: {
  totalTracks: number;
  last24h: number;
  last7d: number;
  dailyCounts: Array<{ day: Date; count: number }>;
  recentQueries: Array<{ query: string; lastSearchedAt: Date | null; exhausted: boolean }>;
  queriesTried: number;
  queriesTotal: number;
  queriesExhausted: number;
  lastBatchAt: Date | null;
  seedKeyConfigured: boolean;
}) {
  const fmtDate = (value: Date | null) => value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Never";
  const hoursSince = data.lastBatchAt ? (Date.now() - new Date(data.lastBatchAt).getTime()) / 3_600_000 : Infinity;
  // The batch runs hourly; anything past ~26h means either the service has been asleep
  // (Render free tier) or the job is erroring silently.
  const freshnessLabel = !data.lastBatchAt ? "Hasn't run yet" : hoursSince < 2 ? "Running normally" : hoursSince < 26 ? "A bit behind schedule" : "Stalled — check Render logs";
  const freshnessColor = !data.lastBatchAt ? "#897c8b" : hoursSince < 2 ? "#83c8a5" : hoursSince < 26 ? "#e9c45a" : "#ef8796";

  const maxDaily = Math.max(1, ...data.dailyCounts.map((day) => day.count));
  const dailyRows = data.dailyCounts.map((day) => `
    <div class="bar-row">
      <span class="bar-label">${escapeHtml(new Date(day.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, Math.round(day.count / maxDaily * 100))}%"></div></div>
      <span class="bar-count">${day.count}</span>
    </div>`).join("");

  const queryRows = data.recentQueries.map((row) => `
    <tr><td>${escapeHtml(row.query)}</td><td>${fmtDate(row.lastSearchedAt)}</td><td>${row.exhausted ? "Exhausted" : "Active"}</td></tr>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Connectify Library status</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 18px 60px; background: #0f0a12; color: #f8f4e9; font-family: -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 21px; margin: 0 0 4px; }
  .sub { color: #897c8b; font-size: 13px; margin: 0 0 26px; }
  .stat-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 22px; }
  .stat { flex: 1; min-width: 130px; padding: 15px 17px; border: 1px solid rgba(248,244,233,.11); border-radius: 14px; background: #1c1420; }
  .stat .n { font-size: 26px; font-weight: 800; color: #f6dbc0; }
  .stat .l { font-size: 11.5px; color: #b6a9b7; margin-top: 4px; }
  .panel { padding: 17px 19px; border: 1px solid rgba(248,244,233,.11); border-radius: 14px; background: #1c1420; margin-bottom: 16px; }
  .panel h2 { font-size: 12.5px; margin: 0 0 13px; text-transform: uppercase; letter-spacing: .08em; color: #c57da3; }
  .freshness { display: flex; align-items: center; gap: 9px; font-size: 14px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: ${freshnessColor}; flex: 0 0 auto; }
  .bar-row { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 4px 0; }
  .bar-label { width: 52px; color: #897c8b; flex: 0 0 auto; }
  .bar-track { flex: 1; height: 8px; border-radius: 5px; background: rgba(248,244,233,.08); overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg,#935073,#c57da3); border-radius: 5px; }
  .bar-count { width: 26px; text-align: right; color: #f8f4e9; flex: 0 0 auto; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; color: #897c8b; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; padding-bottom: 8px; }
  td { padding: 7px 0; border-top: 1px solid rgba(248,244,233,.08); color: #f8f4e9; }
  .refresh { display: inline-block; margin-top: 4px; color: #c57da3; font-size: 13px; text-decoration: none; }
  .config { font-size: 13px; color: #b6a9b7; line-height: 1.7; }
  .config b { color: #f8f4e9; }
</style></head>
<body><div class="wrap">
  <h1>Connectify Library status</h1>
  <p class="sub">Private diagnostic page — not linked anywhere in the app, and not indexed.</p>

  <div class="stat-row">
    <div class="stat"><div class="n">${data.totalTracks.toLocaleString()}</div><div class="l">Total songs in the Library</div></div>
    <div class="stat"><div class="n">${data.last24h}</div><div class="l">Added in the last 24h</div></div>
    <div class="stat"><div class="n">${data.last7d}</div><div class="l">Added in the last 7 days</div></div>
  </div>

  <div class="panel">
    <h2>Seeding job</h2>
    <div class="freshness"><span class="dot"></span><span>${freshnessLabel} &middot; last batch ${fmtDate(data.lastBatchAt)}</span></div>
    <p class="config">
      Dedicated seed key: <b>${data.seedKeyConfigured ? "configured" : "not set — sharing live search's quota"}</b><br />
      Genres tried so far: <b>${data.queriesTried} / ${data.queriesTotal}</b> (${data.queriesExhausted} fully mined out)
    </p>
  </div>

  <div class="panel">
    <h2>Growth, last 14 days</h2>
    ${dailyRows || '<p class="config">No songs added yet.</p>'}
  </div>

  <div class="panel">
    <h2>Most recently searched genres</h2>
    <table><thead><tr><th>Query</th><th>Last searched</th><th>Status</th></tr></thead><tbody>${queryRows || '<tr><td colspan="3">Nothing searched yet.</td></tr>'}</tbody></table>
  </div>

  <a class="refresh" href="${escapeHtml(refreshUrl)}">Refresh</a>
</div></body></html>`;
}

app.get("/api/metrics/library", asyncRoute(async (req, res) => {
  const expected = process.env.METRICS_ADMIN_TOKEN;
  const provided = req.get("authorization") === `Bearer ${expected}` || (typeof req.query.token === "string" && req.query.token === expected);
  // Same 404-not-401 pattern as /api/metrics/dashboard: an unauthenticated request should
  // look identical to hitting a route that doesn't exist.
  if (!expected || !provided) return res.status(404).json({ error: "Not found." });

  const room = await prisma.room.findUnique({ where: { code: LIBRARY_ROOM_CODE }, select: { id: true } });
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);

  const [totalTracks, last24h, last7d, dailyCountsDesc, seedRows, lastBatch, queriesTried, queriesExhausted] = room ? await Promise.all([
    prisma.track.count({ where: { roomId: room.id, removedAt: null } }),
    prisma.track.count({ where: { roomId: room.id, removedAt: null, createdAt: { gte: dayAgo } } }),
    prisma.track.count({ where: { roomId: room.id, removedAt: null, createdAt: { gte: weekAgo } } }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`SELECT date_trunc('day', "createdAt") as day, count(*)::int as count FROM "Track" WHERE "roomId" = ${room.id} AND "removedAt" IS NULL GROUP BY day ORDER BY day DESC LIMIT 14`,
    prisma.librarySeed.findMany({ where: { lastSearchedAt: { not: null } }, orderBy: { lastSearchedAt: "desc" }, take: 12 }),
    prisma.librarySeed.aggregate({ _max: { lastSearchedAt: true } }),
    prisma.librarySeed.count({ where: { lastSearchedAt: { not: null } } }),
    prisma.librarySeed.count({ where: { exhausted: true } }),
  ]) : [0, 0, 0, [], [], { _max: { lastSearchedAt: null } }, 0, 0];

  res.type("html").send(renderLibraryStatusPage(req.originalUrl, {
    totalTracks,
    last24h,
    last7d,
    dailyCounts: [...dailyCountsDesc].reverse().map((row) => ({ day: row.day, count: Number(row.count) })),
    recentQueries: seedRows,
    queriesTried,
    queriesTotal: SEED_QUERIES.length,
    queriesExhausted,
    lastBatchAt: lastBatch._max.lastSearchedAt,
    seedKeyConfigured: Boolean(process.env.YOUTUBE_SEED_API_KEY),
  }));
}));

app.post("/api/rooms", asyncRoute(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(48),
    userId: z.string().min(8).max(80),
    maxParticipants: z.number().int().min(2).max(100).default(50),
  }).parse(req.body);
  const hostToken = newHostToken();
  let room = null;
  for (let attempt = 0; attempt < 5 && !room; attempt += 1) {
    try {
      room = await prisma.room.create({ data: { code: createRoomCode(), name: input.name, createdBy: input.userId, hostTokenHash: hashToken(hostToken), maxParticipants: input.maxParticipants } });
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
    operationId: operationIdSchema.default(() => randomUUID()),
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
  const [member, activeTrackCount, pendingByUser, duplicate, artists, maxPosition, currentFreshTrack] = await Promise.all([
    prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: input.userId } } }),
    prisma.track.count({ where: { roomId: room.id, removedAt: null, playedAt: null } }),
    isHost ? Promise.resolve(0) : prisma.track.count({ where: { roomId: room.id, addedByUserId: input.userId, playedAt: null, removedAt: null, ...(room.currentTrackId ? { NOT: { id: room.currentTrackId } } : {}) } }),
    prisma.track.findFirst({ where: { roomId: room.id, providerId: metadata.providerId, removedAt: null, playedAt: null }, select: { id: true, title: true, addedByUserId: true, autoplayReason: true } }),
    room.partyMode === "discovery" ? prisma.track.findMany({ where: { roomId: room.id }, select: { artist: true } }) : Promise.resolve([]),
    prisma.track.aggregate({ where: { roomId: room.id, removedAt: null }, _max: { position: true } }),
    room.currentTrackId ? prisma.track.findFirst({ where: { id: room.currentTrackId, removedAt: null, playedAt: null }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (activeTrackCount >= 100) return res.status(409).json({ error: "This queue is full." });
  const denial = addTrackDenial({ isLocked: room.isLocked, isReturning: Boolean(member), isHost, isBanned: Boolean(member?.isBanned), guestsCanAdd: room.guestsCanAdd, pending: pendingByUser, limit: room.maxSongsPerUser });
  if (denial) return res.status(403).json({ error: denial });

  const operation = await claimOperation(room.id, input.userId, "queue:add", input.operationId);
  if (!operation.fresh) {
    if (operation.result) return res.status(200).json(operation.result);
    return res.status(202).json({ pending: true, operationId: input.operationId });
  }
  const duplicateIsReplaceableAutoplay = duplicate && duplicate.id !== room.currentTrackId && (duplicate.addedByUserId === "autopilot" || Boolean(duplicate.autoplayReason));
  if (duplicate && !duplicateIsReplaceableAutoplay) {
    await abandonOperation(input.operationId);
    return res.status(409).json({ error: `“${duplicate.title}” is already playing or in the queue.` });
  }
  if (!artistAllowed(room.partyMode, artists.map((track) => track.artist), metadata.artist)) {
    await abandonOperation(input.operationId);
    return res.status(409).json({ error: `${metadata.artist} has already appeared in Discovery Night.` });
  }
  const playNext = Boolean(room.currentTrackId) && input.placement === "next" && (isHost || room.guestsCanControl);
  try {
    const track = await prisma.$transaction(async (tx) => {
      const humanQueueResumedAt = new Date();
      await tx.track.updateMany({
        where: {
          roomId: room.id,
          removedAt: null,
          playedAt: null,
          ...(room.currentTrackId ? { NOT: { id: room.currentTrackId } } : {}),
          OR: [{ addedByUserId: "autopilot" }, { autoplayReason: { not: null } }],
        },
        data: { removedAt: humanQueueResumedAt, removedBy: "human-queue-resumed", playNext: false },
      });
      if (playNext) await tx.track.updateMany({ where: { roomId: room.id, removedAt: null }, data: { playNext: false } });
      const created = await tx.track.create({ data: { roomId: room.id, position: (maxPosition._max.position ?? -1) + 1, addedBy: input.addedBy, addedByUserId: input.userId, playNext, ...metadata } });
      await tx.room.update({
        where: { id: room.id },
        data: {
          ...(currentFreshTrack ? {} : { currentTrackId: created.id, isPlaying: false, playbackPosition: 0, startedAt: null }),
          revision: { increment: 1 },
        },
      });
      return created;
    });
    await completeOperation(input.operationId, track);
    res.status(201).json(track);
    void emitQueueState(room.code).then(() => scheduleRoomEnd(room.code)).catch((error) => console.error("Queue broadcast failed:", error));
  } catch (error) {
    await abandonOperation(input.operationId);
    throw error;
  }
}));

app.post("/api/rooms/:code/playlist", asyncRoute(async (req, res) => {
  const input = z.object({
    url: z.string().url(),
    addedBy: z.string().trim().min(1).max(40),
    userId: z.string().min(8).max(80),
    operationId: operationIdSchema.default(() => randomUUID()),
    hostToken: z.string().max(200).optional(),
  }).parse(req.body);
  const code = String(req.params.code).toUpperCase();
  const playlistId = getPlaylistId(input.url);
  if (!playlistId) return res.status(400).json({ error: "Paste a YouTube playlist link (it contains list=…)." });
  if (isMixPlaylist(playlistId)) return res.status(400).json({ error: "YouTube Mixes are generated per viewer and cannot be imported. Save the songs to a regular playlist first." });
  if (!process.env.YOUTUBE_API_KEY) return res.status(503).json({ error: "Playlist import needs live search to be configured.", code: "SEARCH_UNAVAILABLE" });
  const room = await prisma.room.findUnique({ where: { code } });
  if (!room) return res.status(404).json({ error: "Room not found." });
  const isHost = Boolean(input.hostToken && room.hostTokenHash === hashToken(input.hostToken));
  const [member, activeTrackCount, pendingByUser, existingTracks, maxPosition, currentFreshTrack] = await Promise.all([
    prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: input.userId } } }),
    prisma.track.count({ where: { roomId: room.id, removedAt: null, playedAt: null } }),
    isHost ? Promise.resolve(0) : prisma.track.count({ where: { roomId: room.id, addedByUserId: input.userId, playedAt: null, removedAt: null, ...(room.currentTrackId ? { NOT: { id: room.currentTrackId } } : {}) } }),
    prisma.track.findMany({ where: { roomId: room.id, removedAt: null, playedAt: null }, select: { id: true, providerId: true, artist: true, addedByUserId: true, autoplayReason: true } }),
    prisma.track.aggregate({ where: { roomId: room.id, removedAt: null }, _max: { position: true } }),
    room.currentTrackId ? prisma.track.findFirst({ where: { id: room.currentTrackId, removedAt: null, playedAt: null }, select: { id: true } }) : Promise.resolve(null),
  ]);
  const denial = addTrackDenial({ isLocked: room.isLocked, isReturning: Boolean(member), isHost, isBanned: Boolean(member?.isBanned), guestsCanAdd: room.guestsCanAdd, pending: pendingByUser, limit: room.maxSongsPerUser });
  if (denial) return res.status(403).json({ error: denial });
  // Imports respect the same ceilings as one-by-one adds: the 100-item queue and,
  // for guests, their per-user allowance.
  const allowance = Math.min(100 - activeTrackCount, isHost ? 100 : Math.max(0, room.maxSongsPerUser - pendingByUser));
  if (allowance <= 0) return res.status(409).json({ error: "This queue is full." });
  const operation = await claimOperation(room.id, input.userId, "playlist:import", input.operationId);
  if (!operation.fresh) {
    if (operation.result) return res.status(200).json(operation.result);
    return res.status(202).json({ pending: true, operationId: input.operationId });
  }
  try {
    const items = await fetchPlaylistItems(playlistId);
    const manuallyOccupiedTracks = existingTracks.filter((track) => track.id === room.currentTrackId || (track.addedByUserId !== "autopilot" && !track.autoplayReason));
    const queued = new Set(manuallyOccupiedTracks.map((track) => track.providerId));
    const artists = manuallyOccupiedTracks.map((track) => track.artist);
    const importable: typeof items = [];
    for (const item of items) {
      if (importable.length >= allowance) break;
      if (queued.has(item.providerId)) continue;
      if (!artistAllowed(room.partyMode, [...artists, ...importable.map((chosen) => chosen.artist)], item.artist)) continue;
      queued.add(item.providerId);
      importable.push(item);
    }
    if (!importable.length) {
      await abandonOperation(input.operationId);
      return res.status(409).json({ error: items.length ? "Every playable song in that playlist is already in the queue." : "That playlist has no playable videos." });
    }
    let position = (maxPosition._max.position ?? -1) + 1;
    const created = await prisma.$transaction(async (tx) => {
      await tx.track.updateMany({
        where: {
          roomId: room.id,
          removedAt: null,
          playedAt: null,
          ...(room.currentTrackId ? { NOT: { id: room.currentTrackId } } : {}),
          OR: [{ addedByUserId: "autopilot" }, { autoplayReason: { not: null } }],
        },
        data: { removedAt: new Date(), removedBy: "human-queue-resumed", playNext: false },
      });
      const rows = [];
      for (const item of importable) {
        rows.push(await tx.track.create({ data: { roomId: room.id, url: item.url, provider: "youtube", providerId: item.providerId, title: item.title, artist: item.artist, thumbnail: item.thumbnail, addedBy: input.addedBy, addedByUserId: input.userId, position: position++ } }));
      }
      await tx.room.update({
        where: { id: room.id },
        data: {
          ...(currentFreshTrack ? {} : { currentTrackId: rows[0].id, isPlaying: false, playbackPosition: 0, startedAt: null }),
          revision: { increment: 1 },
        },
      });
      return rows;
    });
    const result = { added: created.length, skipped: items.length - created.length, tracks: created };
    await completeOperation(input.operationId, result);
    res.status(201).json(result);
    void emitQueueState(room.code).then(() => scheduleRoomEnd(room.code)).catch((error) => console.error("Queue broadcast failed:", error));
    void (async () => {
      const event = await prisma.roomActivity.create({ data: { roomId: room.id, actorId: input.userId, actorName: input.addedBy, action: "imported_playlist", target: String(created.length) } });
      io.to(room.code).emit("room:activity", event);
      io.to(room.code).emit("room:event", { id: event.id, actorId: event.actorId, actorName: event.actorName, action: event.action, target: event.target, createdAt: event.createdAt });
    })().catch((error) => console.error("Playlist activity failed:", error));
  } catch (error: any) {
    await abandonOperation(input.operationId);
    if (error?.status === 403 || error?.status === 429) return res.status(503).json({ error: "YouTube playlist import is temporarily unavailable. You can still paste individual URLs.", code: "SEARCH_QUOTA" });
    if (error?.status === 404) return res.status(404).json({ error: "That playlist is private or unavailable." });
    throw error;
  }
}));

type PresencePerson = { id: string; userId: string; name: string; avatar: string; role: "host" | "guest" };
const presence = new Map<string, Map<string, PresencePerson>>();
const joinReservations = new Map<string, Set<string>>();
const uniquePresence = (code: string) => {
  const people = new Map<string, PresencePerson>();
  for (const person of presence.get(code)?.values() ?? []) {
    const previous = people.get(person.userId);
    if (!previous || person.role === "host") people.set(person.userId, person);
  }
  return [...people.values()];
};
const emitPresence = (code: string) => io.to(code).emit("room:presence", uniquePresence(code));
const emitSnapshot = async (code: string) => io.to(code).emit("room:snapshot", await roomSnapshot(code));
const emitQueueState = async (code: string) => io.to(code).emit("room:queue", await roomQueueState(code));
const recordActivity = async (
  code: string,
  socket: Socket,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
) => {
  const roomId = socket.data.roomId as string | undefined;
  const actorId = socket.data.userId as string | undefined;
  if (!roomId || !actorId) return;
  try {
    const event = await prisma.roomActivity.create({
      data: {
        roomId,
        actorId,
        actorName: String(socket.data.name || "Someone"),
        action,
        target,
        detail: detail as any,
      },
    });
    io.to(code).emit("room:activity", event);
    io.to(code).emit("room:event", {
      id: event.id,
      actorId: event.actorId,
      actorName: event.actorName,
      action: event.action,
      target: event.target,
      createdAt: event.createdAt,
    });
  } catch (error) {
    console.error("Room activity write failed:", error);
  }
};
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

async function claimOperation(roomId: string, userId: string, action: string, id: string) {
  try {
    await prisma.roomOperation.create({ data: { id, roomId, userId, action } });
    return { fresh: true, result: null as unknown };
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    const existing = await prisma.roomOperation.findUnique({ where: { id } });
    if (!existing || existing.roomId !== roomId || existing.userId !== userId || existing.action !== action) {
      throw new Error("Operation ID collision.");
    }
    if (!existing.completedAt && Date.now() - existing.createdAt.getTime() > 30_000) {
      const removed = await prisma.roomOperation.deleteMany({ where: { id, completedAt: null } });
      if (removed.count) return claimOperation(roomId, userId, action, id);
    }
    return { fresh: false, result: existing.result };
  }
}

const completeOperation = (id: string, result: unknown) => prisma.roomOperation.update({
  where: { id },
  data: { result: JSON.parse(JSON.stringify(result)) as any, completedAt: new Date() },
});
const abandonOperation = (id: string) => prisma.roomOperation.deleteMany({ where: { id, completedAt: null } });
const operationCleanupTimer = setInterval(() => {
  void prisma.roomOperation.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  }).catch((error) => console.error("Operation receipt cleanup failed:", error));
}, 6 * 60 * 60 * 1000);
operationCleanupTimer.unref();

// Grows the Connectify Library on its own so it doesn't depend on manually adding songs.
// Uses a dedicated key so it never competes with real users' live-search quota; falls back
// to the shared key (sharing that budget) if no dedicated key is configured.
//
// Runs a small batch every hour rather than one big daily pass: a Google Cloud project
// allows 10,000 quota units/day and search.list costs 100, so ~100 calls/day is the
// ceiling. At the default 5 calls/hour the job paces itself to roughly that ceiling
// (~2,500 raw candidate songs/day before dedupe) while staying restart-safe — an
// unlucky redeploy costs one small batch instead of a whole day's allowance. If the
// quota does run out, YouTube answers 403/429 and the batch stops early on its own.
const LIBRARY_SEED_HOURLY_BUDGET = Number(process.env.LIBRARY_SEED_HOURLY_BUDGET || 5);
async function runLibrarySeedBatch() {
  const seedKey = process.env.YOUTUBE_SEED_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!seedKey || LIBRARY_SEED_HOURLY_BUDGET <= 0) return;
  try {
    const room = await ensureLibraryRoom();
    const queries = [...SEED_QUERIES];
    const seedRows = await prisma.librarySeed.findMany({ where: { query: { in: queries } } });
    const seedByQuery = new Map(seedRows.map((row) => [row.query, row]));

    // Two passes on purpose. Rotation narrows the whole catalog to a shortlist using data
    // already in hand, then coverage is counted only for those few. Counting coverage
    // across the entire catalog meant ~150 database round trips per batch, which is what
    // took the container down on the free tier.
    const shortlist = preselectByRotation(
      queries.map((query) => ({
        query,
        lastSearchedAt: seedByQuery.get(query)?.lastSearchedAt ?? null,
        exhausted: seedByQuery.get(query)?.exhausted ?? false,
      })),
      LIBRARY_SEED_HOURLY_BUDGET * 3,
    );
    if (!shortlist.length) return;
    const coverage = await libraryCoverage(shortlist);
    const chosen = pickSeedTargets(
      shortlist.map((query) => ({
        query,
        coverage: coverage[query] ?? 0,
        lastSearchedAt: seedByQuery.get(query)?.lastSearchedAt ?? null,
        exhausted: seedByQuery.get(query)?.exhausted ?? false,
      })),
      LIBRARY_SEED_HOURLY_BUDGET,
    );

    let added = 0;
    let calls = 0;
    for (const query of chosen) {
      const seed = seedByQuery.get(query);
      try {
        // Continue deeper into this query's result pages instead of re-fetching page one,
        // so a query keeps producing new songs across runs rather than cache-hitting itself.
        const result = await searchYouTube(query, seed?.pageToken ?? undefined, seedKey);
        calls += 1;
        const created = await addLibraryTracks(room.code, result.items.map((item) => ({ providerId: item.providerId, title: item.title, artist: item.artist, thumbnail: item.thumbnail, url: item.url })));
        added += created.length;
        await prisma.librarySeed.upsert({
          where: { query },
          create: { query, lastSearchedAt: new Date(), pageToken: result.nextPageToken, pagesFetched: 1, exhausted: !result.nextPageToken },
          // No next page means this query is mined out; park it so the picker skips it.
          update: { lastSearchedAt: new Date(), pageToken: result.nextPageToken, pagesFetched: { increment: 1 }, exhausted: !result.nextPageToken },
        });
      } catch (error: any) {
        console.warn("Library seed search failed:", query, error?.status || error?.message || error);
        await prisma.librarySeed.upsert({ where: { query }, create: { query, lastSearchedAt: new Date() }, update: { lastSearchedAt: new Date() } });
        if (error?.status === 403 || error?.status === 429) break;
      }
    }
    if (calls) console.log(JSON.stringify({ type: "library_seed", queriesRun: calls, tracksAdded: added }));
  } catch (error) {
    console.error("Library seed batch failed:", error);
  }
}
const librarySeedTimer = setInterval(() => void runLibrarySeedBatch(), 60 * 60 * 1000);
librarySeedTimer.unref();
// Give the process a moment to finish booting and serving traffic before the first batch.
setTimeout(() => void runLibrarySeedBatch(), 30_000).unref();

// Per-room standby pool of Smart Discovery candidates, refreshed at most every 30 minutes.
// Backed by the shared search cache, so repeated refills rarely spend YouTube quota.
const discoveryPools = new Map<string, { expiresAt: number; signature: string; seed: string; items: SearchItem[] }>();
async function discoveryPool(code: string, queries: string[]) {
  if (!process.env.YOUTUBE_API_KEY || !queries.length) return null;
  const signature = queries.join("|").toLowerCase();
  const cached = discoveryPools.get(code);
  if (cached && cached.expiresAt > Date.now() && cached.signature === signature) return cached;
  try {
    const seed = queries[Math.floor(Math.random() * queries.length)];
    const result = await searchYouTube(seed);
    const pool = { expiresAt: Date.now() + 30 * 60_000, signature, seed, items: result.items };
    discoveryPools.set(code, pool);
    return pool;
  } catch (error) {
    console.warn("Discovery search unavailable:", error);
    return null;
  }
}

async function recordAutopilotActivity(code: string, roomId: string, action: string, count: number, titles: string[]) {
  const event = await prisma.roomActivity.create({
    data: { roomId, actorId: "autopilot", actorName: "DJ Autopilot", action, target: String(count), detail: { titles } as any },
  });
  io.to(code).emit("room:activity", event);
}

// Fire-and-forget: keep a Smart Autoplay buffer of upcoming songs without ever blocking
// an Add, playback change, queue mutation, or join. Fresh Smart Discovery suggestions are
// blended by the room's Familiar↔Fresh setting; familiar revivals cover the remainder and
// the whole thing degrades to history-only when the key, quota, or pool is unavailable.
async function runAutoplayRefill(code: string) {
  try {
    let suggested: Array<{ roomId: string; title: string }> = [];
    const outlook = await autoplayOutlook(code);
    if (outlook && outlook.need > 0 && outlook.freshness > 0) {
      const roomArtists = topArtists(outlook.historySignals, 6);
      const pool = await discoveryPool(code, discoveryQueries(outlook.historySignals));
      if (pool) {
        const { fresh } = splitAutoplay(outlook.need, outlook.freshness, pool.items.length > 0);
        const picks = pickDiscovery(pool.items, outlook.excludeProviderIds, fresh, [...outlook.upcomingArtists, ...roomArtists]);
        if (picks.length) suggested = await addAutoplayTracks(code, picks, `Inspired by this room's listening history`);
      }
    }
    const revived = await refillAutoplay(code);
    if (!suggested.length && !revived?.length) return;
    await emitQueueState(code);
    await scheduleRoomEnd(code);
    const roomId = suggested[0]?.roomId || revived?.[0]?.roomId;
    if (!roomId) return;
    if (revived?.length) await recordAutopilotActivity(code, roomId, "autoplay_revived", revived.length, revived.slice(0, 3).map((track) => track.title));
    if (suggested.length) await recordAutopilotActivity(code, roomId, "autoplay_suggested", suggested.length, suggested.slice(0, 3).map((track) => track.title));
  } catch (error) {
    console.error("Autoplay refill failed:", error);
  }
}

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
      void runAutoplayRefill(code);
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

  socket.on("room:messages", safe("room:messages", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ before: z.string().datetime().optional() }).safeParse(payload || {});
    if (!code || !parsed.success) return reply({ ok: false });
    const page = await roomMessagesPage(code, parsed.data.before ? new Date(parsed.data.before) : undefined);
    reply(page ? { ok: true, ...page } : { ok: false });
  }));

  socket.on("room:members", safe("room:members", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ cursor: z.string().optional() }).safeParse(payload || {});
    if (!code || !parsed.success) return reply({ ok: false });
    const page = await roomMembersPage(code, parsed.data.cursor);
    reply(page ? { ok: true, ...page } : { ok: false });
  }));

  socket.on("room:history", safe("room:history", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ before: z.string().datetime().optional() }).safeParse(payload || {});
    if (!code || !parsed.success) return reply({ ok: false });
    const page = await roomHistoryPage(code, parsed.data.before ? new Date(parsed.data.before) : undefined);
    reply(page ? { ok: true, ...page } : { ok: false });
  }));

  socket.on("room:activity-page", safe("room:activity-page", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ before: z.string().datetime().optional() }).safeParse(payload || {});
    if (!code || !isHostSocket(socket) || !parsed.success) return reply({ ok: false });
    const page = await roomActivityPage(code, parsed.data.before ? new Date(parsed.data.before) : undefined);
    reply(page ? { ok: true, ...page } : { ok: false });
  }));

  socket.on("room:join", safe("room:join", async (payload, reply = () => undefined) => {
    let releaseReservation: (() => void) | undefined;
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
      } else if (isHost && room.createdBy !== input.userId) {
        issuedHostToken = newHostToken();
        await prisma.$transaction([
          prisma.room.update({ where: { id: room.id }, data: { createdBy: input.userId, hostTokenHash: hashToken(issuedHostToken), revision: { increment: 1 } } }),
          prisma.roomMember.updateMany({ where: { roomId: room.id }, data: { role: "guest" } }),
        ]);
      }
      const denial = joinRoomDenial({ isLocked: room.isLocked, isReturning: Boolean(existing), isHost, isBanned: Boolean(existing?.isBanned) });
      if (denial) return reply({ ok: false, code: existing?.isBanned ? "REMOVED" : "ACCESS_DENIED", error: denial });
      const presentIds = new Set(uniquePresence(code).map((person) => person.userId));
      const reservations = joinReservations.get(code) || new Set<string>();
      joinReservations.set(code, reservations);
      const alreadyPresent = presentIds.has(input.userId) || reservations.has(input.userId);
      const occupied = new Set([...presentIds, ...reservations]).size;
      const effectiveCapacity = isHost ? 100 : Math.min(100, room.maxParticipants);
      if (!alreadyPresent && occupied >= effectiveCapacity) {
        return reply({ ok: false, error: `This room has reached its ${effectiveCapacity}-listener capacity.` });
      }
      if (!alreadyPresent) {
        reservations.add(input.userId);
        releaseReservation = () => {
          reservations.delete(input.userId);
          if (!reservations.size) joinReservations.delete(code);
        };
      }
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
        avatar: input.avatar,
        isHost,
        guestsCanControl: room.guestsCanControl,
        guestsCanAdd: room.guestsCanAdd,
      };
      if (!presence.has(code)) presence.set(code, new Map());
      presence.get(code)!.set(socket.id, { id: socket.id, userId: input.userId, name: input.name, avatar: input.avatar, role });
      releaseReservation?.();
      releaseReservation = undefined;
      if (issuedHostToken && room.createdBy !== input.userId) {
        for (const target of await io.in(code).fetchSockets()) {
          const targetIsHost = target.data.userId === input.userId;
          target.data.isHost = targetIsHost;
          target.emit("room:host-role", { role: targetIsHost ? "host" : "guest" });
          const present = presence.get(code)?.get(target.id);
          if (present) present.role = targetIsHost ? "host" : "guest";
        }
      }
      emitPresence(code);
      if (issuedHostToken && room.createdBy !== input.userId) io.to(code).emit("room:host-changed", { userId: input.userId });
      const [snapshot, votes] = await Promise.all([
        roomSnapshot(code),
        prisma.trackVote.findMany({ where: { userId: input.userId, track: { room: { code } } }, select: { trackId: true } }),
      ]);
      reply({ ok: true, role, hostToken: issuedHostToken, snapshot, votes: votes.map((vote) => vote.trackId) });
      void scheduleRoomEnd(code);
    } catch (error: any) {
      console.error("Room join failed:", error);
      reply(publicJoinFailure(error));
    } finally {
      releaseReservation?.();
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
    const state = await roomQueueState(code);
    io.to(code).emit("room:queue", state);
    reply({ ok: true, state });
    void scheduleRoomEnd(code);
    console.log(JSON.stringify({ type: "socket_timing", event: "playback:set", durationMs: Number((performance.now() - startedAt).toFixed(1)) }));
  }));

  socket.on("playback:advance", safe(async (payload, reply = () => undefined) => {
    const startedAt = performance.now();
    const code = socket.data.code as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ trackId: z.string(), direction: z.union([z.literal(-1), z.literal(1)]), reason: z.enum(["manual", "ended"]).default("manual"), operationId: operationIdSchema.default(() => randomUUID()) }).safeParse(payload);
    if (!code || !userId || !parsed.success) return reply({ ok: false });
    const room = await prisma.room.findUnique({
      where: { code },
      select: { id: true, partyMode: true, currentTrackId: true, isPlaying: true, playbackPosition: true, startedAt: true, tracks: { where: { id: parsed.data.trackId }, select: { duration: true } } },
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
    const operation = await claimOperation(room.id, userId, "playback:advance", parsed.data.operationId);
    if (!operation.fresh) return reply(operation.result || { ok: false, error: "That skip is still being confirmed." });
    const advanced = await advanceRoom(code, parsed.data.trackId, parsed.data.direction);
    if (!advanced) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false });
    }
    const state = await roomQueueState(code);
    io.to(code).emit("room:queue", state);
    const result = { ok: true, state };
    await completeOperation(parsed.data.operationId, result);
    reply(result);
    void scheduleRoomEnd(code);
    void runAutoplayRefill(code);
    if (parsed.data.reason === "manual") void recordActivity(code, socket, "skipped_track");
    console.log(JSON.stringify({ type: "socket_timing", event: "playback:advance", durationMs: Number((performance.now() - startedAt).toFixed(1)) }));
  }));

  socket.on("queue:remove", safe("queue:remove", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ trackId: z.string(), operationId: operationIdSchema.default(() => randomUUID()) }).safeParse(payload);
    if (!code || !roomId || !userId || !parsed.success || !canControl(socket)) return reply({ ok: false });
    const operation = await claimOperation(roomId, userId, "queue:remove", parsed.data.operationId);
    if (!operation.fresh) return reply(operation.result || { ok: false, error: "That removal is still being confirmed." });
    const room = await prisma.room.findUnique({ where: { code }, include: { tracks: { where: { removedAt: null }, orderBy: { position: "asc" } } } });
    if (!room || (room.partyMode === "one_take" && room.currentTrackId === parsed.data.trackId)) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false });
    }
    const target = room.tracks.find((track) => track.id === parsed.data.trackId);
    if (!target) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false });
    }
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
    const result = { ok: true, state };
    await completeOperation(parsed.data.operationId, result);
    reply(result);
    void scheduleRoomEnd(code);
    void runAutoplayRefill(code);
  }));

  socket.on("queue:block-autoplay", safe("queue:block-autoplay", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ trackId: z.string(), operationId: operationIdSchema.default(() => randomUUID()) }).safeParse(payload);
    if (!code || !roomId || !userId || !parsed.success || !canControl(socket)) return reply({ ok: false });
    const operation = await claimOperation(roomId, userId, "queue:block-autoplay", parsed.data.operationId);
    if (!operation.fresh) return reply(operation.result || { ok: true });
    const room = await prisma.room.findUnique({ where: { code }, select: { id: true, currentTrackId: true } });
    const track = await prisma.track.findFirst({ where: { id: parsed.data.trackId, roomId }, select: { id: true, playedAt: true, removedAt: true } });
    if (!room || !track) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false });
    }
    // Block future revival, and drop it from the live queue if it is an upcoming pick.
    const isUpcoming = !track.playedAt && !track.removedAt && track.id !== room.currentTrackId;
    await prisma.$transaction([
      prisma.track.update({ where: { id: track.id }, data: { autoplayBlocked: true, playNext: false, ...(isUpcoming ? { removedAt: new Date(), removedBy: userId } : {}) } }),
      prisma.room.update({ where: { id: room.id }, data: { revision: { increment: 1 } } }),
    ]);
    const state = await roomQueueState(code);
    io.to(code).emit("room:queue", state);
    const result = { ok: true, state };
    await completeOperation(parsed.data.operationId, result);
    reply(result);
    void scheduleRoomEnd(code);
    void runAutoplayRefill(code);
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

  socket.on("queue:bulk", safe("queue:bulk", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({
      trackIds: z.array(z.string()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
      action: z.enum(["remove", "top", "bottom"]),
      operationId: operationIdSchema.default(() => randomUUID()),
    }).safeParse(payload);
    if (!code || !roomId || !userId || !isHostSocket(socket) || !parsed.success) {
      return reply({ ok: false, error: "Host access required." });
    }
    const operation = await claimOperation(roomId, userId, `queue:bulk:${parsed.data.action}`, parsed.data.operationId);
    if (!operation.fresh) return reply(operation.result || { ok: false, error: "That bulk action is still being confirmed." });
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { tracks: { where: { removedAt: null, playedAt: null }, orderBy: { position: "asc" } } },
    });
    if (!room) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false });
    }
    const selected = room.tracks.filter((track) => parsed.data.trackIds.includes(track.id) && track.id !== room.currentTrackId);
    if (!selected.length) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false, error: "Select at least one upcoming item." });
    }
    const selectedIds = selected.map((track) => track.id);
    if (parsed.data.action === "remove") {
      await prisma.$transaction([
        prisma.track.updateMany({
          where: { roomId, id: { in: selectedIds } },
          data: { removedAt: new Date(), removedBy: userId, playNext: false },
        }),
        prisma.room.update({ where: { id: roomId }, data: { revision: { increment: 1 } } }),
      ]);
      const remainingIds = room.tracks.filter((track) => !selectedIds.includes(track.id)).map((track) => track.id);
      await normalizePositions(roomId, remainingIds);
    } else {
      const untouched = room.tracks.filter((track) => !selectedIds.includes(track.id) && track.id !== room.currentTrackId);
      const currentIds = room.currentTrackId ? [room.currentTrackId] : [];
      const nextOrder = parsed.data.action === "top"
        ? [...currentIds, ...selectedIds, ...untouched.map((track) => track.id)]
        : [...currentIds, ...untouched.map((track) => track.id), ...selectedIds];
      await normalizePositions(roomId, nextOrder);
      await prisma.room.update({ where: { id: roomId }, data: { revision: { increment: 1 } } });
    }
    const state = await roomQueueState(code);
    const result = { ok: true, state };
    await completeOperation(parsed.data.operationId, result);
    reply(result);
    io.to(code).emit("room:queue", state);
    void recordActivity(code, socket, `bulk_${parsed.data.action}`, `${selectedIds.length} queue items`);
  }));

  socket.on("queue:vote", safe("queue:vote", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ trackId: z.string(), operationId: operationIdSchema.default(() => randomUUID()) }).safeParse(payload);
    if (!code || !roomId || !userId || !parsed.success) return reply({ ok: false });
    const operation = await claimOperation(roomId, userId, "queue:vote", parsed.data.operationId);
    if (!operation.fresh) return reply(operation.result || { ok: false, error: "That vote is still being confirmed." });
    const track = await prisma.track.findFirst({ where: { id: parsed.data.trackId, removedAt: null, room: { code } }, select: { id: true } });
    if (!track) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false });
    }
    let result: { ok: true; alreadyVoted: boolean };
    try {
      const [, updated] = await prisma.$transaction([prisma.trackVote.create({ data: { trackId: track.id, userId } }), prisma.track.update({ where: { id: track.id }, data: { votes: { increment: 1 } } })]);
      io.to(code).emit("queue:vote-updated", { trackId: track.id, votes: updated.votes });
      result = { ok: true, alreadyVoted: false };
    } catch (error: any) {
      if (error?.code === "P2002") result = { ok: true, alreadyVoted: true };
      else {
        await abandonOperation(parsed.data.operationId);
        throw error;
      }
    }
    await completeOperation(parsed.data.operationId, result);
    reply(result);
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

  socket.on("room:profile", safe("room:profile", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({
      name: z.string().trim().min(1).max(30),
      avatar: z.string().min(1).max(8),
    }).safeParse(payload);
    if (!code || !roomId || !userId || !parsed.success) return reply({ ok: false, error: "Choose a valid name and avatar." });
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { ...parsed.data, lastSeenAt: new Date() },
    });
    socket.data.name = parsed.data.name;
    socket.data.avatar = parsed.data.avatar;
    for (const targetSocket of await io.in(code).fetchSockets()) {
      if (targetSocket.data.userId === userId) {
        targetSocket.data.name = parsed.data.name;
        targetSocket.data.avatar = parsed.data.avatar;
      }
    }
    for (const target of presence.get(code)?.values() ?? []) {
      if (target.userId === userId) Object.assign(target, parsed.data);
    }
    emitPresence(code);
    reply({ ok: true });
  }));

  socket.on("room:settings", safe("room:settings", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    if (!code || !isHostSocket(socket)) return reply({ ok: false, error: "Host access required." });
    const parsed = z.object({
      autopilotEnabled: z.boolean().optional(), partyMode: partyModeSchema.optional(), theme: themeSchema.optional(),
      autoplayMinBuffer: z.number().int().min(1).max(10).optional(),
      autoplayFreshness: z.number().int().min(0).max(100).optional(),
      isLocked: z.boolean().optional(), guestsCanControl: z.boolean().optional(), guestsCanAdd: z.boolean().optional(),
      maxSongsPerUser: z.number().int().min(1).max(20).optional(),
      maxParticipants: z.number().int().min(2).max(100).optional(),
      chatSlowMode: z.union([z.literal(0), z.literal(2), z.literal(5), z.literal(10), z.literal(30)]).optional(),
      discoverable: z.boolean().optional(),
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
    const state = await prisma.room.findUnique({ where: { code }, select: { revision: true, autopilotEnabled: true, autoplayMinBuffer: true, autoplayFreshness: true, partyMode: true, theme: true, isLocked: true, guestsCanControl: true, guestsCanAdd: true, maxSongsPerUser: true, maxParticipants: true, chatSlowMode: true, discoverable: true } });
    io.to(code).emit("room:settings-patch", { ...state, serverTime: new Date().toISOString() });
    if (parsed.data.autopilotEnabled !== undefined) void runAutoplayRefill(code);
    if (parsed.data.partyMode) void recordActivity(code, socket, "changed_mode", parsed.data.partyMode);
    else if (parsed.data.maxParticipants) void recordActivity(code, socket, "changed_capacity", String(parsed.data.maxParticipants));
    else if (parsed.data.chatSlowMode !== undefined) void recordActivity(code, socket, "changed_slow_mode", String(parsed.data.chatSlowMode));
  }));

  socket.on("room:recover-host", safe("room:recover-host", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    const parsed = z.object({ recoveryKey: z.string().min(32).max(200) }).safeParse(payload);
    if (!code || !roomId || !userId || !parsed.success) return reply({ ok: false, error: "Invalid recovery key." });
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { hostTokenHash: true } });
    if (!room?.hostTokenHash || room.hostTokenHash !== hashToken(parsed.data.recoveryKey)) {
      return reply({ ok: false, error: "That recovery key is not valid for this room." });
    }
    const nextRecoveryKey = newHostToken();
    await prisma.$transaction([
      prisma.room.update({ where: { id: roomId }, data: { createdBy: userId, hostTokenHash: hashToken(nextRecoveryKey), revision: { increment: 1 } } }),
      prisma.roomMember.updateMany({ where: { roomId }, data: { role: "guest" } }),
      prisma.roomMember.update({ where: { roomId_userId: { roomId, userId } }, data: { role: "host", lastSeenAt: new Date() } }),
    ]);
    for (const target of await io.in(code).fetchSockets()) {
      const targetIsHost = target.data.userId === userId;
      target.data.isHost = targetIsHost;
      target.emit("room:host-role", { role: targetIsHost ? "host" : "guest" });
      const present = presence.get(code)?.get(target.id);
      if (present) present.role = targetIsHost ? "host" : "guest";
    }
    emitPresence(code);
    io.to(code).emit("room:host-changed", { userId });
    reply({ ok: true, role: "host", hostToken: nextRecoveryKey });
  }));

  socket.on("room:handoff-host", safe("room:handoff-host", async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const roomId = socket.data.roomId as string | undefined;
    const currentUserId = socket.data.userId as string | undefined;
    const parsed = z.object({ targetUserId: z.string().min(8).max(80) }).safeParse(payload);
    if (!code || !roomId || !currentUserId || !isHostSocket(socket) || !parsed.success) return reply({ ok: false, error: "Host access required." });
    if (parsed.data.targetUserId === currentUserId) return reply({ ok: false, error: "You already host this room." });
    const roomSockets = await io.in(code).fetchSockets();
    if (!roomSockets.some((target) => target.data.userId === parsed.data.targetUserId)) {
      return reply({ ok: false, error: "Choose someone who is currently in the room." });
    }
    const targetMember = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId, userId: parsed.data.targetUserId } }, select: { id: true, name: true } });
    if (!targetMember) return reply({ ok: false, error: "That member is no longer available." });
    const nextRecoveryKey = newHostToken();
    await prisma.$transaction([
      prisma.room.update({ where: { id: roomId }, data: { createdBy: parsed.data.targetUserId, hostTokenHash: hashToken(nextRecoveryKey), revision: { increment: 1 } } }),
      prisma.roomMember.updateMany({ where: { roomId }, data: { role: "guest" } }),
      prisma.roomMember.update({ where: { id: targetMember.id }, data: { role: "host", lastSeenAt: new Date() } }),
    ]);
    for (const target of roomSockets) {
      const targetIsHost = target.data.userId === parsed.data.targetUserId;
      target.data.isHost = targetIsHost;
      target.emit("room:host-role", { role: targetIsHost ? "host" : "guest" });
      if (targetIsHost) target.emit("room:host-transferred", { hostToken: nextRecoveryKey });
      const present = presence.get(code)?.get(target.id);
      if (present) present.role = targetIsHost ? "host" : "guest";
    }
    emitPresence(code);
    io.to(code).emit("room:host-changed", { userId: parsed.data.targetUserId });
    reply({ ok: true });
    void recordActivity(code, socket, "handed_off_host", targetMember.name);
  }));

  socket.on("room:kick", safe(async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ memberId: z.string() }).safeParse(payload);
    if (!code || !isHostSocket(socket) || !parsed.success) return reply({ ok: false });
    const member = await prisma.roomMember.findFirst({ where: { id: parsed.data.memberId, room: { code }, role: { not: "host" } } });
    if (!member) return reply({ ok: false });
    await prisma.roomMember.update({ where: { id: member.id }, data: { isBanned: true } });
    void recordActivity(code, socket, "blocked_member", member.name);
    for (const target of await io.in(code).fetchSockets()) {
      if (target.data.userId === member.userId) { target.emit("room:kicked"); target.disconnect(true); }
    }
    reply({ ok: true });
    await emitSnapshot(code);
  }));

  socket.on("room:remove", safe(async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ memberId: z.string() }).safeParse(payload);
    if (!code || !isHostSocket(socket) || !parsed.success) return reply({ ok: false, error: "Host access required." });
    const member = await prisma.roomMember.findFirst({ where: { id: parsed.data.memberId, room: { code }, role: { not: "host" }, isBanned: false } });
    if (!member) return reply({ ok: false, error: "That listener is no longer available." });
    let removed = false;
    for (const target of await io.in(code).fetchSockets()) {
      if (target.data.userId === member.userId) {
        removed = true;
        target.emit("room:removed");
        target.disconnect(true);
      }
    }
    void recordActivity(code, socket, "removed_member", member.name);
    reply({ ok: true, wasOnline: removed });
  }));

  socket.on("room:blocked-members", safe(async (_payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    if (!code || !isHostSocket(socket)) return reply({ ok: false, error: "Host access required." });
    const members = await prisma.roomMember.findMany({
      where: { room: { code }, isBanned: true },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
      select: { id: true, userId: true, name: true, avatar: true, role: true, joinedAt: true, lastSeenAt: true },
    });
    reply({ ok: true, members });
  }));

  socket.on("room:unblock", safe(async (payload, reply = () => undefined) => {
    const code = socket.data.code as string | undefined;
    const parsed = z.object({ memberId: z.string() }).safeParse(payload);
    if (!code || !isHostSocket(socket) || !parsed.success) return reply({ ok: false, error: "Host access required." });
    const member = await prisma.roomMember.findFirst({ where: { id: parsed.data.memberId, room: { code }, isBanned: true } });
    if (!member) return reply({ ok: false, error: "That blocked listener no longer exists." });
    await prisma.roomMember.update({ where: { id: member.id }, data: { isBanned: false } });
    void recordActivity(code, socket, "unblocked_member", member.name);
    reply({ ok: true });
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
    void recordActivity(code, socket, "cleared_queue");
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
    const parsed = z.object({
      body: z.string().trim().min(1).max(300),
      spoiler: z.boolean().default(false),
      trackId: z.string().nullable(),
      position: z.number().min(0).max(86400).nullable(),
      replyToId: z.string().nullable().optional(),
      operationId: operationIdSchema.default(() => randomUUID()),
    }).safeParse(payload);
    if (!code || !userId || !parsed.success) return reply({ ok: false });
    const person = presence.get(code)?.get(socket.id);
    const room = await prisma.room.findUnique({ where: { code }, select: { id: true, currentTrackId: true, chatSlowMode: true } });
    if (!room || !person) return reply({ ok: false });
    const operation = await claimOperation(room.id, userId, "room:chat", parsed.data.operationId);
    // Repeated presses and reconnect retries carry the same operationId: resolve to one message.
    // A completed op replays its stored receipt; an in-flight one is idempotent success (the
    // original send still broadcasts, and the client reconciles by operationId).
    if (!operation.fresh) return reply(operation.result || { ok: true });
    const slowModeMs = isHostSocket(socket) ? 700 : Math.max(700, room.chatSlowMode * 1_000);
    if (Date.now() - Number(socket.data.lastChatAt || 0) < slowModeMs) {
      await abandonOperation(parsed.data.operationId);
      const remaining = Math.ceil((slowModeMs - (Date.now() - Number(socket.data.lastChatAt || 0))) / 1_000);
      return reply({ ok: false, error: `Slow mode: wait ${remaining}s before sending again.` });
    }
    const replyTo = parsed.data.replyToId
      ? await prisma.chatMessage.findFirst({ where: { id: parsed.data.replyToId, roomId: room.id }, select: { id: true } })
      : null;
    if (parsed.data.replyToId && !replyTo) {
      await abandonOperation(parsed.data.operationId);
      return reply({ ok: false, error: "That message is no longer available." });
    }
    const trackId = parsed.data.trackId === room.currentTrackId ? parsed.data.trackId : null;
    socket.data.lastChatAt = Date.now();
    const message = await prisma.chatMessage.create({
      data: {
        roomId: room.id,
        trackId,
        userId,
        name: person.name,
        avatar: person.avatar,
        body: parsed.data.body,
        position: trackId ? parsed.data.position : null,
        spoiler: parsed.data.spoiler,
        replyToId: replyTo?.id,
      },
      include: { replyTo: { select: { id: true, name: true, body: true, spoiler: true } } },
    });
    io.to(code).emit("room:chat", { ...message, operationId: parsed.data.operationId });
    const result = { ok: true, messageId: message.id };
    await completeOperation(parsed.data.operationId, result);
    reply(result);
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
