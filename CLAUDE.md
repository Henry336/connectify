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
- **Render does not swap traffic on a failed health check.** A deploy that crashes on boot
  is marked "Failed" and the *previous* successful deploy keeps serving — silently. This
  means `curl /health` staying "up" through a bad push is not evidence the new code is
  live; it can just as easily mean the new build failed and the old one never stopped
  answering. The Render dashboard's Deploys tab (status per commit SHA) is the only
  reliable source of truth for "which commit is actually running" — check it directly
  rather than inferring from HTTP behavior.

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

### 2026-08-09 — Codex

- Refined the landing page's persistent-room history to present only the three most
  recently opened rooms while preserving the complete local history. Each visible entry
  now includes its room code, creation date, and last-opened date. Existing saved rooms
  acquire their authoritative creation date the next time they are opened.
- Replaced the fixed `Friday night mix` default with 36 equally weighted room names.
  Guest identities now draw from 30 adjectives and 30 nouns using rejection-sampled
  random indices, producing 900 equally selectable combinations without modulo bias.
- Client production build and name-pool uniqueness/count checks pass. No database or API
  changes were required.

### 2026-08-06 (evening) — Claude Code (Opus 5/Sonnet 5)

- **Room video player restored to true 16:9** (`client/src/room/room-enhancements.css`).
  An earlier pass that day had shrunk it to `16/6` to make the search bar reachable
  without scrolling on common laptop heights; that read as visibly squashed on real
  video content, so it's back to a faithful ratio. The no-page-scroll shell from the
  earlier pass is untouched and still correct — this just means the listening column
  itself scrolls again on shorter screens to reach the search bar, which is expected
  and was flagged as the likely tradeoff when the compression first went in.
- **Changelog data centralized** into `client/src/changelog-data.ts` (`RELEASES`,
  newest first). Both `WhatsNew.tsx` (the gated first-run overlay) and the new
  `ChangelogHistory.tsx` (an on-demand reader, launched from a "What's new" button in
  the landing page header) now read from this one array instead of each keeping its
  own copy. `whats-new.ts`'s `CHANGELOG_VERSION` derives from `RELEASES[0].version`.
  **Keep `RELEASES` capped at 3 entries** — when shipping a 4th release, add it to the
  front and drop the oldest. The full permanent history stays in `CHANGELOG.md`;
  `RELEASES` is deliberately just the rolling window the on-demand reader shows.
  `ChangelogHistory` reuses FeatureModal (normal Escape/backdrop/close-button dismissal,
  no scroll-gate — that gate is specific to the first-run overlay).

**Verified in a real browser**, not just typechecked: the "What's new" button opens the
reader, shows 1 release with 7 sections and a "Latest" tag, Escape and reopening both
work cleanly (an initial synchronous DOM check after dispatching Escape read `true` — a
measurement-timing artifact from checking before React flushed its state update, not a
real bug; re-checking after a tick showed the modal gone). Video aspect ratio confirmed
via computed style: 800px width now yields exactly 450px height (16:9).

### 2026-08-06 (later) — Claude Code (Opus 5)

Added a user-facing changelog in two places, both written in plain language for listeners
rather than for developers, and both avoiding em dashes by request:

- **`CHANGELOG.md`** at the repo root is the running record. Newest release first.
- **In-app "What's new" overlay** (`client/src/WhatsNew.tsx`, `whats-new.css`,
  `whats-new.ts`), mounted in `App.tsx`. It appears once per device per release, gated on
  `CHANGELOG_VERSION` stored under `connectify.changelogSeen`. There is deliberately no
  Escape handler and no backdrop-click dismiss: the button stays disabled until the reader
  scrolls to the end, then pressing it lights the button, collapses the panel into the
  app's own loading mark (the `connection-visual` rings and core reused from `RoomPage`),
  and fades out. First-ever visitors are skipped, since release notes make no sense for an
  app someone has not used yet; the version is silently marked seen for them instead.

**Shipping a future release:** add a section to `CHANGELOG.md`, mirror it into the
`SECTIONS` array in `WhatsNew.tsx`, and bump `CHANGELOG_VERSION` in `whats-new.ts`.

**Verified in a real browser** (Vite dev server, not just types): the overlay renders with
all sections, the button stays disabled until the scroll container reaches the end, the
hint text switches, the version persists on click, the phases advance
reading → launching → closing, and the overlay unmounts leaving the app usable. The CSS
collapse rule was confirmed to apply by toggling the class with transitions disabled
(660px → 210px). **The animation itself was not visually verified** — the automated
browser pane was not compositing frames, so transitions never advanced and screenshots
were unavailable. Worth one human look on a real device.

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

**Incident, now resolved:** the deploy of `f677f51` (PR #5) **failed at startup**. All eight
migrations had applied cleanly (verified in `_prisma_migrations`), so it was not a Prisma
failure — Render's dashboard showed "Failed" for that commit, meaning it never received
traffic; the previous successful deploy kept serving throughout (see the Render deploy note
above). Root cause: `libraryCoverage()` fanned ~150 concurrent `count` queries at the Neon
pool 30 s after boot, which the free-tier container did not survive — a defect introduced
in PR #4 and tripled in severity by PR #5 growing the seed catalog 50 → 150. Fixed directly
on `main` as commit `16e457f`: a two-phase select where `preselectByRotation` narrows the
catalog to a small shortlist using only in-memory rotation data, then `libraryCoverage`
counts sequentially (not `Promise.all`) over just that shortlist.
**Confirmed fixed** — `16e457f` shows "Live" on Render's Deploys tab (the authoritative
signal; it only appears once the health check passes) and has stayed up since, so the
startup crash does not recur.

**Important caveat for whoever picks this up:** most of this session's work was never run
against a real database or browser before merging — there is no local Postgres in that
environment. Unit tests (51) and both builds passed, but that is not the same as
integration testing, and it is exactly how the above incident reached production undetected
until a deploy failure surfaced it. Playlist import, offline mode, Smart Discovery, and the
background-playback changes have still never been exercised end to end — verify before
trusting. Prefer testing against a real deploy (or at least a local Postgres) before merging
future schema or startup-path changes, not after.
