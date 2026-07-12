import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Clock3, Copy, Heart, Link2, ListMusic, MoreHorizontal, Pause, Play, Plus, Radio, Search, Share2, SkipBack, SkipForward, Trash2, Users, Volume2, X } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL } from "./api";
import { getIdentity } from "./identity";
import type { Person, Room, Track } from "./types";
import { YouTubePlayer } from "./YouTubePlayer";

const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const effectivePosition = (room: Room) => room.playbackPosition + (room.isPlaying && room.startedAt ? Math.max(0, (Date.now() - new Date(room.startedAt).getTime()) / 1000) : 0);

function PlaybackProgress({ room, current, onSeek }: { room: Room; current: Track | null; onSeek: (position: number) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!room.isPlaying) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [room.isPlaying]);
  const elapsed = room.playbackPosition + (room.isPlaying && room.startedAt ? Math.max(0, (now - new Date(room.startedAt).getTime()) / 1000) : 0);
  const duration = current?.duration || 240;
  return <div className="progress-wrap"><input aria-label="Song progress" type="range" min="0" max={duration} value={Math.min(elapsed, duration)} onChange={(event) => onSeek(Number(event.target.value))} style={{ "--progress": `${Math.min(100, elapsed / duration * 100)}%` } as React.CSSProperties} /><div><span>{formatTime(elapsed)}</span><span>{current?.duration ? formatTime(current.duration) : "—:—"}</span></div></div>;
}
const avatars = ["🌻", "🪩", "🎧", "🌙", "🛼", "✨"];

export function RoomPage({ code }: { code: string }) {
  const identity = getIdentity();
  const [room, setRoom] = useState<Room | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [url, setUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);
  const [votedTrackIds, setVotedTrackIds] = useState<Set<string>>(() => new Set());
  const [volume, setVolume] = useState(72);

  useEffect(() => {
    let active = true;
    api<Room>(`/api/rooms/${code}`).then((data) => active && setRoom((previous) => !previous || data.revision >= previous.revision ? data : previous)).catch((err) => setError(err.message));
    const connection = io(API_URL, { transports: ["websocket", "polling"] });
    connection.on("connect", () => connection.emit("room:join", { code, ...identity }));
    connection.on("room:snapshot", (snapshot: Room) => setRoom((previous) => !previous || snapshot.revision >= previous.revision ? snapshot : previous));
    connection.on("room:presence", setPeople);
    connection.on("queue:votes", (ids: string[]) => setVotedTrackIds(new Set(ids)));
    connection.on("queue:vote-updated", ({ trackId, votes }: { trackId: string; votes: number }) => {
      setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.map((track) => track.id === trackId ? { ...track, votes } : track) } : previous);
    });
    setSocket(connection);
    return () => { active = false; connection.disconnect(); };
  }, [code]);

  const current = room?.tracks.find((track) => track.id === room.currentTrackId) ?? null;
  const filteredTracks = useMemo(() => room?.tracks.filter((track) => `${track.title} ${track.artist} ${track.addedBy}`.toLowerCase().includes(filter.toLowerCase())) ?? [], [room?.tracks, filter]);

  const setPlayback = useCallback((track: Track | null, isPlaying: boolean, position = 0) => {
    if (track) socket?.emit("playback:set", { trackId: track.id, isPlaying, position });
  }, [socket]);
  const skip = useCallback((direction: -1 | 1) => {
    if (!current) return;
    socket?.emit("playback:advance", { trackId: current.id, direction });
  }, [current, socket]);
  const vote = useCallback((trackId: string) => {
    if (!socket || votedTrackIds.has(trackId)) return;
    setVotedTrackIds((previous) => new Set(previous).add(trackId));
    socket.emit("queue:vote", { trackId }, (result: { ok: boolean; alreadyVoted?: boolean }) => {
      if (!result?.ok) setVotedTrackIds((previous) => { const next = new Set(previous); next.delete(trackId); return next; });
    });
  }, [socket, votedTrackIds]);
  const addTrack = async (event: React.FormEvent) => {
    event.preventDefault(); if (!url.trim()) return;
    setAdding(true); setError("");
    try { await api(`/api/rooms/${code}/tracks`, { method: "POST", body: JSON.stringify({ url, addedBy: identity.name }) }); setUrl(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not add that track."); }
    finally { setAdding(false); }
  };
  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };
  const move = (track: Track, delta: number) => {
    if (!room) return;
    const ids = room.tracks.map((item) => item.id); const from = ids.indexOf(track.id); const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]]; socket?.emit("queue:reorder", { trackIds: ids });
  };

  if (!room) return <main className="room-loading"><a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a><div className="loading-record" />{error ? <><h2>We couldn’t find that room.</h2><a href="/">Go back home</a></> : <p>Tuning in to {code}…</p>}</main>;

  return <main className="room-shell">
    <header className="room-nav">
      <a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a>
      <div className="room-title-mobile"><strong>{room.name}</strong><span><i /> Live</span></div>
      <div className="room-nav-actions">
        <div className="listeners"><div className="avatar-stack">{people.slice(0, 4).map((person, i) => <i key={`${person.userId}-${i}`} title={person.name}>{person.avatar || avatars[i]}</i>)}</div><span>{people.length} listening</span></div>
        <button className="secondary" onClick={copyInvite}>{copied ? <Check size={17} /> : <Share2 size={17} />}{copied ? "Copied" : "Invite"}</button>
        <button className="icon-button" aria-label="More options"><MoreHorizontal /></button>
      </div>
    </header>

    <section className="room-content">
      <div className="listening-pane">
        <div className="room-heading"><a href="/" aria-label="Leave room"><ArrowLeft /></a><div><div className="live-label"><i /> LIVE ROOM · {room.code}</div><h1>{room.name}</h1></div></div>

        <div className="now-card">
          <div className="video-stage">
            {current ? <YouTubePlayer key={current.id} track={current} room={room} volume={volume} onEnded={() => skip(1)} /> : <div className="empty-record"><ListMusic /><span>Add the first song</span></div>}
            <div className="stage-vignette" />
            <button className={`heart-button ${liked ? "liked" : ""}`} onClick={() => setLiked(!liked)} aria-label="Like song"><Heart fill={liked ? "currentColor" : "none"} /></button>
            {current && <div className="source-badge">YOUTUBE</div>}
          </div>
          <div className="track-info">
            <div><span className="now-label">NOW PLAYING</span><h2>{current?.title || "The room is quiet"}</h2><p>{current?.artist || "Paste a YouTube link to get started"}</p></div>
            {current && <a href={current.url} target="_blank" rel="noreferrer" className="icon-button" aria-label="Open source"><Link2 /></a>}
          </div>
          <PlaybackProgress room={room} current={current} onSeek={(position) => current && setPlayback(current, room.isPlaying, position)} />
          <div className="main-controls">
            <button className="control-small" onClick={() => skip(-1)} disabled={!current}><SkipBack fill="currentColor" /></button>
            <button className="play-button" onClick={() => setPlayback(current, !room.isPlaying, effectivePosition(room))} disabled={!current}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
            <button className="control-small" onClick={() => skip(1)} disabled={!current}><SkipForward fill="currentColor" /></button>
          </div>
          <div className="volume-row"><Volume2 size={17} /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ "--progress": `${volume}%` } as React.CSSProperties} /></div>
        </div>

        <form className="add-bar" onSubmit={addTrack}>
          <span className="provider-icon">▶</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube link to add a song…" aria-label="YouTube URL" /><button disabled={adding || !url}><Plus size={19} />{adding ? "Adding…" : "Add to queue"}</button>
        </form>
        {error && <div className="inline-error"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        <div className="quick-reactions"><span>React to the moment</span>{["🔥", "💜", "🥹", "🕺", "✨"].map((emoji) => <button key={emoji} onClick={(e) => { const button = e.currentTarget; button.classList.add("pop"); setTimeout(() => button.classList.remove("pop"), 400); }}>{emoji}</button>)}</div>
      </div>

      <aside className="queue-pane">
        <div className="queue-header"><div><span>UP NEXT</span><h2>Room queue <small>{room.tracks.length}</small></h2></div><button className="icon-button" aria-label="Queue options"><MoreHorizontal /></button></div>
        <label className="queue-search"><Search size={17} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search queue" /></label>
        <div className="queue-list">
          {filteredTracks.map((track, index) => {
            const active = track.id === current?.id;
            return <article key={track.id} className={`queue-item ${active ? "active" : ""}`}>
              <button className="queue-thumb" onClick={() => setPlayback(track, true, 0)} aria-label={`Play ${track.title}`}><img src={track.thumbnail || ""} alt="" /><span>{active && room.isPlaying ? <i className="equalizer"><b /><b /><b /></i> : <Play size={15} fill="currentColor" />}</span></button>
              <div className="queue-meta"><strong>{track.title}</strong><span>{track.artist}</span><small>Added by {track.addedBy}</small></div>
              <div className="queue-actions"><button className={votedTrackIds.has(track.id) ? "voted" : ""} onClick={() => vote(track.id)} disabled={votedTrackIds.has(track.id)} title={votedTrackIds.has(track.id) ? "Already voted" : "Vote up"}><Heart size={14} fill={votedTrackIds.has(track.id) ? "currentColor" : "none"} />{track.votes || ""}</button><button onClick={() => move(track, -1)} disabled={index === 0} title="Move up"><ArrowUp size={14} /></button><button onClick={() => move(track, 1)} disabled={index === filteredTracks.length - 1} title="Move down"><ArrowDown size={14} /></button><button onClick={() => socket?.emit("queue:remove", { trackId: track.id })} title="Remove"><Trash2 size={14} /></button></div>
            </article>;
          })}
          {!filteredTracks.length && <div className="queue-empty"><ListMusic /><strong>{filter ? "No matches" : "Your queue is empty"}</strong><span>{filter ? "Try another search." : "Paste a link to start the music."}</span></div>}
        </div>
        <div className="queue-footer"><Clock3 size={15} /><span>{room.tracks.length ? `About ${Math.round(room.tracks.length * 4)} min of music` : "Ready for a song"}</span></div>
      </aside>
    </section>

    {current && <div className="mobile-player"><img src={current.thumbnail || ""} alt="" /><div><strong>{current.title}</strong><span>{current.artist}</span></div><button onClick={() => setPlayback(current, !room.isPlaying, effectivePosition(room))}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button onClick={() => skip(1)}><ChevronRight /></button></div>}
  </main>;
}
