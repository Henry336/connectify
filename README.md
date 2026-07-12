# Connectify

Connectify is a shared listening room: create a room, paste a YouTube URL, and everyone in the room gets the same queue and playback state in real time.

## What works

- Shareable six-character listening rooms
- YouTube URL parsing and metadata lookup (no YouTube API key required)
- Synchronized play, pause, seek, skip, and track selection
- Persistent PostgreSQL queue, ordering, votes, and playback state
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

### Render backend

The root `render.yaml` creates the Node web service and PostgreSQL database. In Render, create a Blueprint from this repository, then set:

- `CLIENT_URL=https://your-connectify.vercel.app`
- `DATABASE_URL` is injected automatically by the Blueprint database.

Render runs pending Prisma migrations whenever the service starts. The included free plans are suitable for an MVP preview, but Render's free Postgres database expires after 30 days and has no backups. For production usage, choose a paid Render instance and PostgreSQL plan; free services may sleep and are unsuitable for uninterrupted realtime rooms.

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

- Add room ownership and signed authentication before exposing moderator actions publicly.
- Track per-user votes to prevent repeat voting.
- Add rate limiting and a Redis Socket.IO adapter when scaling beyond one backend instance.
- Add provider adapters only after confirming their playback and account requirements.
