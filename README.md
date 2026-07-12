# Connectify

Connectify is a shared listening room: create a room, paste a YouTube URL, and everyone in the room gets the same queue and playback state in real time.

## What works

- Shareable six-character listening rooms
- YouTube URL parsing and metadata lookup (no YouTube API key required)
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

1. Copy `.env.example` to `server/.env`, and set `DATABASE_URL` and `CLIENT_URL`.
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

Render runs pending Prisma migrations whenever the service starts. A free Render web service may sleep, so the first room request after inactivity can take longer.

### Vercel frontend

Import the repository into Vercel and configure:

- Root Directory: `client`
- Framework Preset: Vite
- Environment variable: `VITE_API_URL=https://your-connectify-api.onrender.com`

`client/vercel.json` keeps direct room URLs working with client-side routing.

## Architecture

- `client/`: React, Vite, Socket.IO client, YouTube IFrame Player API
- `server/`: Express, Socket.IO, Prisma
- `server/prisma/`: PostgreSQL schema and migrations

The server owns room state. Clients send intentions, the server persists the mutation, and every listener receives a new authoritative snapshot. On reconnect, the stored timestamp and position allow the player to catch up.

## Production follow-ups

- Add optional user accounts if room ownership needs to follow hosts across browsers and devices; current moderation uses private per-room host tokens.
- Add rate limiting and a Redis Socket.IO adapter when scaling beyond one backend instance.
- Add provider adapters only after confirming their playback and account requirements.
