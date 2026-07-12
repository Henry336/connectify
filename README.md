# Connectify

Connectify is a shared listening room: create a room, paste a YouTube URL, and everyone in the room gets the same queue and playback state in real time.

## What works

- Shareable six-character listening rooms
- YouTube URL parsing and metadata lookup (no YouTube API key required)
- Hybrid search: instant opt-in Connectify Library results plus paginated live YouTube search
- Two-level YouTube result cache (bounded in-memory LRU plus PostgreSQL) and concurrent-request deduplication
- Installable PWA share target for sending YouTube links directly into recent rooms on supported devices
- Synchronized play, pause, seek, skip, and track selection
- Persistent PostgreSQL queue, ordering, votes, and playback state
- Fair Queue contributor rotation with one vote per person and song
- Opt-in DJ Autopilot that revives crowd favorites after fresh picks run out
- Persistent timestamped Moments with synchronized replay
- Live, shareable Room DNA generated from session activity
- Five shared Party Modes: Standard, Pass the AUX, Blind Pick, One Take, and Discovery Night
- Persistent member roster, listening history, room themes, and recent-room shortcuts
- Host-token protected moderation, room locking, guest permissions, bans, and queue limits
- Watch Party mode with theater layout, timestamped persistent chat, spoiler hiding, and moment jumping
- Queue intelligence with duplicate blocking, Play Next, learned durations, ETAs, and undo removal
- Clock-skew-safe playback timing, continuous drift correction, connection health, and host resync
- Live listener presence
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

Create a Render Web Service from this repository with Root Directory `server`, Build Command `npm install && npm run build`, and Start Command `npm start`. Set:

- `CLIENT_URL=https://your-connectify.vercel.app`
- `DATABASE_URL` to the direct Neon PostgreSQL connection string
- `NODE_VERSION=22`
- `YOUTUBE_API_KEY` to a Google Cloud API key with YouTube Data API v3 enabled (optional, but required for live YouTube search)

Render runs pending Prisma migrations whenever the service starts. A free Render web service may sleep, so the first room request after inactivity can take longer.

### Vercel frontend

Import the repository into Vercel and configure:

- Root Directory: `client`
- Framework Preset: Vite
- Environment variable: `VITE_API_URL=https://your-connectify-api.onrender.com`

`client/vercel.json` keeps direct room URLs working with client-side routing.

### Search and quota behavior

Pasting a YouTube URL remains available at all times and does not use the YouTube search quota. Connectify Library searches the current room plus rooms whose host explicitly enabled **Contribute to discovery**; only video metadata is exposed, never room or member details.

Live search requests 25 embeddable results at a time and supports repeated **Load 25 more results** pagination. The backend normalizes equivalent queries, deduplicates simultaneous searches, keeps a bounded 15-minute memory cache, and persists results in Neon for 24 hours. Each uncached result page uses one YouTube `search.list` request, so keep the API key on Render only—never add it to Vercel or a `VITE_` variable. If quota is unavailable, URL paste and Connectify Library continue working.

To enable live search, create or select a Google Cloud project, enable **YouTube Data API v3**, create an API key, restrict it to that API, then save it as `YOUTUBE_API_KEY` in Render and redeploy. Restricting by server IP is only practical if your Render plan provides a stable outbound IP.

The PWA share target appears after installing Connectify from a compatible browser/OS. Share a YouTube link to Connectify, then choose one of the rooms previously visited on that device.

## Architecture

- `client/`: React, Vite, Socket.IO client, YouTube IFrame Player API
- `server/`: Express, Socket.IO, Prisma
- `server/prisma/`: PostgreSQL schema and migrations

The server owns room state. Clients send intentions, the server persists the mutation, and every listener receives a new authoritative snapshot. On reconnect, the stored timestamp and position allow the player to catch up.

## Production follow-ups

- Add optional user accounts if room ownership needs to follow hosts across browsers and devices; current moderation uses private per-room host tokens.
- Add rate limiting and a Redis Socket.IO adapter when scaling beyond one backend instance.
- Add provider adapters only after confirming their playback and account requirements.
