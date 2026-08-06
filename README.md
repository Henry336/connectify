# Connectify

Connectify is a shared listening room: create a room, paste a YouTube URL, and everyone in the room gets the same queue and playback state in real time.

## What works

- Shareable six-character listening rooms
- YouTube URL parsing and metadata lookup (no YouTube API key required)
- Hybrid search: instant opt-in Connectify Library results plus paginated live YouTube search
- YouTube playlist import (up to 50 songs per paste; requires the live-search API key)
- Smart Autoplay: room-history revival blended with clearly labeled fresh suggestions via a host-controlled Familiar↔Fresh setting, degrading to history-only without an API key
- Recent searches, quick re-add of recently added songs, and already-queued markers in search results
- Keyboard shortcuts with a "?" help panel, per-device queue/chat tab memory, and focus-preserving composers
- Read-only offline room browsing from a saved copy, a non-blocking reconnect notice, and reduced-data behavior on Data Saver connections
- Two-level YouTube result cache (bounded in-memory LRU plus PostgreSQL) and concurrent-request deduplication
- Installable PWA share target for sending YouTube links directly into recent rooms on supported devices
- Synchronized play, pause, seek, skip, and track selection
- Persistent PostgreSQL queue, ordering, votes, and playback state
- Fair Queue contributor rotation with one vote per person and song
- Opt-in DJ Autopilot that revives crowd favorites after fresh picks run out
- Persistent timestamped Moments with synchronized replay
- Room-wide chat with unread tracking, replies, mentions, spoilers, date separators, optional alerts, and paginated history
- Live, shareable Room DNA generated from session activity
- Five shared Party Modes: Standard, Pass the AUX, Blind Pick, One Take, and Discovery Night
- Persistent member roster, listening history, room themes, and recent-room shortcuts
- Host-token protected moderation, room locking, guest permissions, bans, and queue limits
- Watch Party mode with theater layout, timestamped persistent chat, spoiler hiding, and moment jumping
- Queue intelligence with duplicate blocking, Play Next, learned durations, ETAs, and undo removal
- Clock-skew-safe playback timing, continuous drift correction, connection health, and host resync
- Automatic revision-gap recovery plus retry-safe add, skip, vote, remove, and chat mutations
- Lazy room snapshots with paginated chat, listening history, and member rosters
- Accountless recovery keys and secure host handoff with automatic key rotation
- Mobile autoplay recovery guidance and Media Session lock-screen controls where supported
- Live listener presence
- Host-configurable 2–100 listener capacity, a fixed 100-item active queue ceiling, and configurable chat slow mode
- Editable accountless profiles, remembered device volume, local-time queue ETAs, and a dismissible first-room guide
- Touch queue dragging, host multi-select tools, rendering containment, and moderation activity history
- Core Web Vitals collection, privacy-safe database timings, selective snapshot compression, and 10/50/100-listener load tooling
- Responsive room and mobile player interface

This MVP deliberately supports YouTube first. Spotify playback is not interchangeable with an ordinary embed: synchronized full-track playback requires Spotify authorization for every listener and Spotify Premium eligibility. The provider boundary can be extended when that product decision is made.

## Local setup

Requirements: Node.js 22+ and PostgreSQL.

1. Copy `.env.example` to `server/.env`, and set `DATABASE_URL` and `CLIENT_URL`. Add `YOUTUBE_API_KEY` only if you want live YouTube search.
2. Create `client/.env.local` with `VITE_API_URL=http://localhost:3001`.
3. Install and initialize:

   ```bash
   npm install
   npm run db:migrate
   npm run dev
   ```

The frontend runs on `http://localhost:5173`; the API runs on `http://localhost:3001`.

## Deploy

### Render backend with Neon PostgreSQL

The checked-in `render.yaml` configures a Singapore Web Service. If configuring it manually, use Root Directory `server`, Build Command `npm install && npm run build && npm run db:deploy`, and Start Command `npm start`. Set:

- `CLIENT_URL=https://your-connectify.vercel.app`
- `DATABASE_URL` to Neon’s pooled PostgreSQL connection string (the hostname contains `-pooler`)
- `NODE_VERSION=22`
- `NODE_ENV=production`
- `YOUTUBE_API_KEY` to a Google Cloud API key with YouTube Data API v3 enabled (optional, but required for live YouTube search)
- `METRICS_ADMIN_TOKEN` to a long random value if you want the protected Web Vitals summary (optional)
- `DB_TIMINGS=all` only during a short measurement window if you need every query timing; production otherwise logs only queries taking at least 50 ms

Keep the Neon project in AWS Singapore when possible. Existing Render services should also be checked in the Dashboard because changing `render.yaml` does not relocate an already-created service. Prisma migrations run during deployment. As a safety net for manually configured Render services, `npm start` also applies pending migrations before accepting traffic; already-applied migrations are a no-op.

The reliability release adds the `RoomOperation` idempotency table and chat reply relation. Render’s existing build command already runs `npm run db:deploy`, so the checked-in migration is applied automatically before the updated server starts. Deploy the backend before or alongside the frontend; no new environment variables are required.

The frontend calls `/ready` as soon as someone opens the landing page or a direct room link. This wakes Render and executes a minimal Neon query while the visitor is reading the page. A free Render web service can still require a cold start after inactivity; pre-warming moves that delay earlier but cannot guarantee an instant first request.

### Vercel frontend

Import the repository into Vercel and configure:

- Root Directory: `client`
- Framework Preset: Vite
- `VITE_API_URL=https://your-connectify-api.onrender.com`
- `VITE_SITE_URL=https://your-connectify.vercel.app`
- `VITE_GOOGLE_SITE_VERIFICATION=...` after Google Search Console provides the verification token (optional)

Use the stable production Vercel URL—not a preview deployment—for `VITE_SITE_URL`, then redeploy. `client/vercel.json` keeps direct room URLs working and sends `noindex` headers for private room and share-target pages. Preview builds generate `noindex` public pages automatically.

### Search indexing

The client build prerenders `/`, `/listen-together`, `/watch-party`, `/features`, `/how-it-works`, `/faq`, `/privacy`, and `/terms`. It also generates production-aware canonical metadata, `robots.txt`, `sitemap.xml`, Open Graph metadata, and truthful `WebApplication` structured data.

After the production Vercel deployment:

1. Add the production URL as a URL-prefix property in Google Search Console.
2. Save Google’s HTML-tag token as `VITE_GOOGLE_SITE_VERIFICATION` in Vercel and redeploy.
3. Submit `https://your-connectify.vercel.app/sitemap.xml`.
4. Add the same site to Bing Webmaster Tools, or import it from Search Console.
5. Inspect `/`, `/listen-together`, and `/watch-party`; do not request indexing for `/room/*`.

Room codes, names, messages, and member lists are never included in the sitemap. AdSense is intentionally not loaded; active room/player pages are not suitable ad surfaces.

### Search and quota behavior

Pasting a YouTube URL remains available at all times and does not use the YouTube search quota. Connectify Library searches the current room plus rooms whose host explicitly enabled **Contribute to discovery**; only video metadata is exposed, never room or member details.

Live search requests 25 embeddable results at a time and supports repeated **Load 25 more results** pagination. The backend normalizes equivalent queries, deduplicates simultaneous searches, keeps a bounded 15-minute memory cache, and persists results in Neon for 24 hours. Each uncached result page uses one YouTube `search.list` request, so keep the API key on Render only—never add it to Vercel or a `VITE_` variable. If quota is unavailable, URL paste and Connectify Library continue working.

To enable live search, create or select a Google Cloud project, enable **YouTube Data API v3**, create an API key, restrict it to that API, then save it as `YOUTUBE_API_KEY` in Render and redeploy. Restricting by server IP is only practical if your Render plan provides a stable outbound IP.

A Google Cloud project's default quota is 10,000 units/day, and `search.list` costs 100 units, so `YOUTUBE_API_KEY` supports roughly 100 live-search requests a day—each returning up to 25 candidate songs, not 25 finished additions, since results still pass through room limits and duplicate checks before landing in a queue.

### Automated Connectify Library growth

Because Library contribution only happens when a real room searches, plays, and adds a song, the library otherwise grows only as fast as people use Connectify. An optional background job closes that gap: roughly every 20 hours it searches a rotating list of ~50 genres, decades, and moods, favoring whichever are least represented in the library so far, and adds new results (never anything already in the library) to a permanent, non-joinable system room. Contributions are credited to "Connectify Library," never mixed into a real host's queue, and logged with `{"type":"library_seed"}` in the server logs.

Set `YOUTUBE_SEED_API_KEY` to a **second** Google Cloud API key (same setup as above, in its own project so it carries its own 10,000-unit daily quota) to run this without ever touching the quota real users' live searches depend on. Without a second key it falls back to sharing `YOUTUBE_API_KEY`'s quota. `LIBRARY_SEED_DAILY_BUDGET` (default 30) caps how many `search.list` calls the job spends per run—30 calls is up to ~750 raw candidate songs before deduplication, well under either key's daily ceiling.

The PWA share target appears after installing Connectify from a compatible browser/OS. Share a YouTube link to Connectify, then choose one of the rooms previously visited on that device.

## Architecture

- `client/`: React, Vite, Socket.IO client, YouTube IFrame Player API
- `server/`: Express, Socket.IO, Prisma
- `server/prisma/`: PostgreSQL schema and migrations

The server owns room state. Clients apply actions optimistically, send intentions, and converge on revisioned incremental server patches. Full snapshots are reserved for joining and explicit recovery. On reconnect, the stored timestamp and position allow the player to catch up.

For a symptom-by-symptom explanation of the original delays, their root causes, the optimized request and playback paths, instrumentation, trade-offs, and the production test runbook, read [Performance and Reliability Architecture](docs/PERFORMANCE_AND_RELIABILITY.md).

### Scale and performance tooling

Socket.IO compresses payloads only above 4 KB, avoiding needless CPU work on small incremental events. Chat, history, and member data use paginated server reads; long room lists use browser rendering containment so off-screen rows skip normal paint and layout work.

Run the staged concurrency harness against a local or disposable backend:

```bash
npm run test:load
```

Set `LOAD_TEST_API_URL=https://your-disposable-backend.example` for a remote environment and optionally `LOAD_TEST_SIZES=10,50,100`. The harness creates temporary rooms, prints join-latency percentiles, and disconnects every simulated listener. Do not point it at a busy production room.

With `METRICS_ADMIN_TOKEN` configured, `GET /api/metrics/dashboard` returns a protected 24-hour Core Web Vitals summary when called with `Authorization: Bearer <token>`. It includes p50/p75/p95 and good-rating percentages. Room paths are normalized to `/room/:code`; no identity, room name, chat text, URL, or database parameter is logged.

Redis remains intentionally absent while Render runs one backend instance. Add the Socket.IO Redis adapter only when two or more backend instances need to share broadcasts.

## Production follow-ups

- Add optional user accounts if room ownership needs to follow hosts across browsers and devices; current moderation uses private per-room host tokens.
- Add rate limiting and a Redis Socket.IO adapter when scaling beyond one backend instance.
- Add provider adapters only after confirming their playback and account requirements.
