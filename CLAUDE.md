# Connectify — canonical project context

**This file is the single source of truth for any AI tool or human working on this repo.**
It is intentionally model-agnostic: nothing here depends on a particular assistant. If you
are an AI tool other than Claude, read this file first — `AGENTS.md` just points here.

Keep it current. When you finish meaningful work, add a **Working log** entry at the
bottom (newest first) so the next session — in any tool, with no memory of prior chats —
can pick up exactly where things stand.

---

## What this project is

Connectify is a **shared listening room**: create a room, paste a YouTube URL, and
everyone in the room hears the same queue and playback position in real time. Rooms are
accountless — identity is a locally-stored `userId`, and host rights are a per-room
recovery token, not a login.

YouTube is deliberately the only provider. Spotify is not interchangeable with an embed:
synchronized full-track playback would require per-listener Spotify auth plus Premium,
which breaks the no-login shared-room model.

- **Production frontend:** https://connectify-client-lake.vercel.app
- **Production API:** https://connectify-pa1b.onrender.com
- **Repo:** https://github.com/Henry336/connectify

## Layout and stack

npm workspaces monorepo. Node 22+, PostgreSQL (Neon).

| Path | What it is |
| --- | --- |
| `client/` | React 19 + Vite 6 + TypeScript, Socket.IO client, YouTube IFrame Player API |
| `server/` | Express 5 + Socket.IO + Prisma 6 + zod |
| `server/prisma/` | Schema and hand-written SQL migrations |
| `docs/` | Performance/reliability architecture, room interface critique |

## Key commands

```bash
npm run dev          # client on :5173, server on :3001
npm run build        # server build, then client (tsc --noEmit + vite + prerender)
npm test             # server unit tests (node --test via tsx)
npm run db:migrate   # prisma migrate dev  (local)
npm run db:deploy    # prisma migrate deploy (production; also runs on Render start)
npm run test:load    # staged concurrency harness — never point at a busy production room
```

## Architecture rules

These are load-bearing. Breaking them causes subtle, hard-to-debug failures.

- **The server owns room state.** Clients apply actions optimistically, send intentions,
  and converge on revisioned incremental patches. Full snapshots are for joining and
  explicit recovery only.
- **`revision` must move by exactly 1 per patch.** `mergeIncremental` in
  `client/src/RoomPage.tsx` drops any patch that skips a revision and forces a full
  `room:sync`. A mutation that bumps `revision` without emitting a matching patch leaves
  every client one behind.
- **Every patch must carry `serverTime`.** Without it the client fabricates one from its
  own clock, which corrupts drift math and causes spurious seeks.
- **Mutations are idempotent via `RoomOperation`.** Client generates a UUID `operationId`;
  the server claims it, and a repeat resolves to the same result instead of acting twice.
  Any new mutation should follow this.
- **Never block the interaction path.** Autoplay refill and library seeding run
  fire-and-forget *after* the broadcast. Add / playback / queue / join must never wait on
  a recommendation or a YouTube call.
- **Free-tier database discipline.** Neon pooled connections and a 512 MB Render
  container. Never fan out unbounded `Promise.all` over database queries — this has
  already taken production down once (see Working log 2026-08-06).
- **Adding a host setting touches 5 places:** `schema.prisma` + migration, the zod object
  in `server/src/index.ts` (`room:settings`), that handler's `select`, `Room` in
  `client/src/types.ts`, and `updateSettings`' `Pick<>` in `client/src/RoomPage.tsx`.

## Navigating the code

- `server/src/index.ts` is large — HTTP routes first, then `io.on("connection")` with all
  socket handlers. Business logic is factored into the sibling modules below.
- `server/src/room-service.ts` — Prisma client owner, `fairQueueOrder`, snapshot/patch read
  models, `advanceRoom`, autoplay refill, library-room helpers.
- `server/src/room-policy.ts` — pure permission/party-mode predicates. Dependency-free and
  the most heavily tested module. Put new rules here.
- `server/src/discovery.ts`, `library-seed.ts`, `song-key.ts` — pure helpers for Smart
  Autoplay and library growth. All unit-tested; keep them dependency-free.
- `client/src/RoomPage.tsx` is the big one (~1100 lines) — room state, sockets, all modals.
- `client/src/YouTubePlayer.tsx` — the entire playback surface: drift correction, pre-cue,
  background-tab guards. Treat changes here as high risk; test on two devices, not two tabs.
- Styles cascade in three layers: `styles.css` (base) → `redesign.css` (Violet Dusk) →
  `room/room-enhancements.css` (loaded last, wins ties).

## Testing

`server/src/*.test.ts`, run by `node --test` through tsx. Style: `node:assert/strict`, a
small local factory helper, full-sentence test names that read as product behavior. Tests
are pure-function only — nothing touches Prisma, sockets, or the network. There is no
client test suite; `tsc --noEmit` inside `npm run build -w client` is the type gate.

## Deployment

- **Backend → Render** (`render.yaml`, Singapore, free plan). Build runs
  `npm run db:deploy`; `npm start` runs `prisma migrate deploy` again as a safety net, so
  **a bad migration takes the whole service down**. Deploy backend before/with frontend.
- **Frontend → Vercel**, root directory `client`. Auto-deploys from `main`.
- Free Render services spin down after ~15 min idle (~50 s cold start).
  `.github/workflows/keep-awake.yml` pings `/health` to prevent that. The schedule covers
  ~22 h/day on purpose: the free plan allows 750 instance-hours/month against 744 hours in
  a 31-day month, so 24/7 pinging would run within hours of suspension.
- **Diagnosing a failed deploy:** check `_prisma_migrations` in the Neon SQL editor first —
  `finished_at` NULL means a migration failed; all rows populated means the crash is in
  application startup, not Prisma.

## NOT in git — back these up in a password manager

None of the following live in the repo, and several cannot be recovered if lost.

| Secret | Where it lives | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Render env | Neon pooled connection string (hostname contains `-pooler`). Re-copyable from Neon. |
| `YOUTUBE_API_KEY` | Render env | Google Cloud, YouTube Data API v3. Rotatable. |
| `YOUTUBE_SEED_API_KEY` | Render env | **Separate Google Cloud project** — a second key in the same project shares one 10,000-unit daily quota and buys nothing. Rotatable. |
| `METRICS_ADMIN_TOKEN` | Render env | Optional; guards `/api/metrics/dashboard`. Rotatable. |
| `RENDER_API_URL` | GitHub Actions **variable** | Used by the keep-awake workflow. Not secret, but the workflow no-ops without it. |
| **Room host recovery keys** | Users' browser `localStorage` only | **Not rotatable and not recoverable.** The server stores only a SHA-256 hash. Losing one means losing host rights to that room permanently, with no reset path. |

`.env.example` documents every variable; copy it to `server/.env` for local work.
Never commit real values, and never paste a secret into a chat with an AI tool.

---

## Working log

Newest first. Add an entry whenever meaningful work lands: date, tool, what changed,
current state.

### 2026-08-06 — Claude Code (Opus 5)

**Shipped, merged to `main`:**
- **PR #2 — QOL wave 1.** Chat: composer font fixed (a `.chat-composer` vs `.chat-compose`
  selector typo had pinned it at 10px), Enter-to-send with Shift+Enter, optimistic send
  with `operationId` reconciliation so repeats can't duplicate, wall-clock timestamps.
  Instant add-song (optimistic `currentTrackId` so the first song pre-buffers). Playback:
  next-track pre-cue, startup grace window, `document.hidden` guards, auto-skip on fatal
  video errors. Room Rewind autoplay default-on, backfilled to existing rooms.
- **PR #3 — QOL wave 2.** Smart Discovery (Familiar↔Fresh), YouTube playlist import,
  read-only offline room browsing, keyboard shortcuts, recent searches, already-queued
  markers, persisted tab, Data Saver support.
- **PR #4 / #5 — Library growth.** Automated seeding into a hidden `LIBRAY` system room
  from a ~150-query catalog, paged across runs, deduped by normalized `songKey` so
  re-uploads of one song don't each become a row. Autoplay default moved to Fresh (80).
  Queue drag handles restyled (they were rendering with the browser's default button face).

**Current state — one open problem:**
- The Render deploy of `f677f51` **failed at startup**. All eight migrations applied
  cleanly (verified in `_prisma_migrations`), so it is *not* a Prisma failure. Production
  is serving the previous build; the database schema is ahead of the running code, which
  is safe.
- Root cause identified as `libraryCoverage()` fanning ~150 concurrent `count` queries at
  the Neon pool 30 s after boot, which the free-tier container did not survive. Fixed on
  branch `library-scale-and-polish` (not yet merged) by a two-phase select: rotation
  narrows the catalog to a shortlist first, then coverage is counted sequentially over
  only that shortlist. **Not yet confirmed against production** — the raw startup stderr
  was never captured, so this is a strong inference, not a proven fix.
- The `LIBRAY` room exists but holds zero tracks, consistent with the crash happening
  immediately after room creation.

**Important caveat for whoever picks this up:** none of this session's work was ever run
against a real database or browser — there is no local Postgres in that environment. Unit
tests (51) and both builds pass, but playlist import, offline mode, Smart Discovery,
seeding, and the background-playback changes have never executed end to end. Verify before
trusting.
