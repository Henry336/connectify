import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Clock3, Copy, Dna, Heart, Info, Link2, ListMusic, LogOut, MoreHorizontal, Pause, Play, Plus, Radio, RotateCw, Search, Share2, SkipBack, SkipForward, Sparkles, Trash2, Volume2, WandSparkles, X } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL } from "./api";
import { getIdentity } from "./identity";
import type { Moment, Person, Room, Track } from "./types";
import { YouTubePlayer } from "./YouTubePlayer";

const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const effectivePosition = (room: Room) => room.playbackPosition + (room.isPlaying && room.startedAt ? Math.max(0, (Date.now() - new Date(room.startedAt).getTime()) / 1000) : 0);
const avatars = ["🌻", "🪩", "🎧", "🌙", "🛼", "✨"];
const reactionChoices = ["🔥", "💜", "🥹", "🕺", "✨"] as const;

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

function FeatureModal({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="feature-modal"><header><span>{icon}</span><h2>{title}</h2><button className="icon-button" onClick={onClose}><X /></button></header>{children}</section></div>;
}

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
  const [roomMenu, setRoomMenu] = useState(false);
  const [queueMenu, setQueueMenu] = useState(false);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [fairInfoOpen, setFairInfoOpen] = useState(false);
  const [momentBursts, setMomentBursts] = useState<Moment[]>([]);

  useEffect(() => {
    let active = true;
    api<Room>(`/api/rooms/${code}`).then((data) => active && setRoom((previous) => !previous || data.revision >= previous.revision ? data : previous)).catch((err) => setError(err.message));
    const connection = io(API_URL, { transports: ["websocket", "polling"] });
    connection.on("connect", () => connection.emit("room:join", { code, ...identity }));
    connection.on("room:snapshot", (snapshot: Room) => setRoom((previous) => !previous || snapshot.revision >= previous.revision ? snapshot : previous));
    connection.on("room:presence", setPeople);
    connection.on("queue:votes", (ids: string[]) => setVotedTrackIds(new Set(ids)));
    connection.on("queue:vote-updated", ({ trackId, votes }: { trackId: string; votes: number }) => setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.map((track) => track.id === trackId ? { ...track, votes } : track) } : previous));
    connection.on("room:moment", (moment: Moment) => {
      setRoom((previous) => previous ? { ...previous, moments: [...previous.moments, moment].slice(-60) } : previous);
      setMomentBursts((previous) => [...previous, moment].slice(-5));
      window.setTimeout(() => setMomentBursts((previous) => previous.filter((item) => item.id !== moment.id)), 2600);
    });
    setSocket(connection);
    return () => { active = false; connection.disconnect(); };
  }, [code]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".menu-wrap")) { setRoomMenu(false); setQueueMenu(false); } };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  const current = room?.tracks.find((track) => track.id === room.currentTrackId) ?? null;
  const orderedTracks = useMemo(() => room?.queueOrder.map((id) => room.tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)) ?? [], [room]);
  const filteredTracks = useMemo(() => orderedTracks.filter((track) => `${track.title} ${track.artist} ${track.addedBy}`.toLowerCase().includes(filter.toLowerCase())), [orderedTracks, filter]);
  const currentMoments = useMemo(() => room?.moments.filter((moment) => moment.trackId === current?.id).slice(-6).reverse() ?? [], [room?.moments, current?.id]);
  const roomDna = useMemo(() => {
    const tracks = room?.tracks ?? [];
    const contributors = new Set(tracks.map((track) => track.addedByUserId || track.addedBy));
    const artists = new Map<string, number>();
    tracks.forEach((track) => artists.set(track.artist, (artists.get(track.artist) || 0) + 1));
    const topArtist = [...artists.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Waiting for a first artist";
    const contributorCounts = new Map<string, number>();
    tracks.forEach((track) => contributorCounts.set(track.addedBy, (contributorCounts.get(track.addedBy) || 0) + 1));
    const topContributor = [...contributorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Nobody yet";
    const titles = tracks.map((track) => `${track.title} ${track.artist}`).join(" ").toLowerCase();
    const vibe = /party|dance|remix|club|hype|disco/.test(titles) ? "Neon dancefloor" : /chill|lofi|sleep|acoustic|slow/.test(titles) ? "After-hours glow" : /love|heart|kiss|baby/.test(titles) ? "Soft-heart singalong" : /19\d\d|200\d|throwback|classic/.test(titles) ? "Nostalgia transmission" : "Eclectic night drive";
    const energy = Math.min(100, 30 + (titles.match(/party|dance|remix|rock|live|hype|fire/g)?.length || 0) * 12);
    const discovery = tracks.length ? Math.round(artists.size / tracks.length * 100) : 0;
    const togetherness = Math.min(100, contributors.size * 18 + Math.min(people.length, 5) * 8);
    const love = Math.min(100, Math.round((tracks.reduce((sum, track) => sum + track.votes, 0) + (room?.moments.length || 0)) / Math.max(1, tracks.length) * 18));
    return { vibe, topArtist, topContributor, energy, discovery, togetherness, love, contributors: contributors.size };
  }, [room?.tracks, room?.moments.length, people.length]);

  const setPlayback = useCallback((track: Track | null, isPlaying: boolean, position = 0) => { if (track) socket?.emit("playback:set", { trackId: track.id, isPlaying, position }); }, [socket]);
  const skip = useCallback((direction: -1 | 1) => { if (current) socket?.emit("playback:advance", { trackId: current.id, direction }); }, [current, socket]);
  const vote = useCallback((trackId: string) => {
    if (!socket || votedTrackIds.has(trackId)) return;
    setVotedTrackIds((previous) => new Set(previous).add(trackId));
    socket.emit("queue:vote", { trackId }, (result: { ok: boolean }) => { if (!result?.ok) setVotedTrackIds((previous) => { const next = new Set(previous); next.delete(trackId); return next; }); });
  }, [socket, votedTrackIds]);
  const react = (emoji: typeof reactionChoices[number], button: HTMLButtonElement) => {
    if (!current || !room || !socket) return;
    button.classList.add("pop"); window.setTimeout(() => button.classList.remove("pop"), 400);
    socket.emit("room:react", { trackId: current.id, emoji, position: effectivePosition(room) });
  };
  const addTrack = async (event: React.FormEvent) => {
    event.preventDefault(); if (!url.trim()) return;
    setAdding(true); setError("");
    try { await api(`/api/rooms/${code}/tracks`, { method: "POST", body: JSON.stringify({ url, addedBy: identity.name, userId: identity.userId }) }); setUrl(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not add that track."); }
    finally { setAdding(false); }
  };
  const copyInvite = async () => { await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const move = (track: Track, delta: number) => {
    const ids = orderedTracks.filter((item) => item.id !== current?.id).map((item) => item.id); const from = ids.indexOf(track.id); const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]]; socket?.emit("queue:reorder", { trackIds: ids });
  };
  const copyQueue = async () => { await navigator.clipboard.writeText(orderedTracks.map((track, index) => `${index + 1}. ${track.title} — ${track.artist}`).join("\n") || "Connectify queue is empty"); setQueueMenu(false); };
  const shareDna = async () => { await navigator.clipboard.writeText(`${room?.name || "Our room"} is a ${roomDna.vibe.toLowerCase()} — ${roomDna.contributors} contributors, ${roomDna.topArtist} on repeat, ${roomDna.love}% crowd love. ${window.location.href}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };

  if (!room) return <main className="room-loading"><a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a><div className="loading-record" />{error ? <><h2>We couldn’t find that room.</h2><a href="/">Go back home</a></> : <p>Tuning in to {code}…</p>}</main>;

  return <main className="room-shell">
    <header className="room-nav">
      <a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a>
      <div className="room-title-mobile"><strong>{room.name}</strong><span><i /> Live</span></div>
      <div className="room-nav-actions">
        <div className="listeners"><div className="avatar-stack">{people.slice(0, 4).map((person, index) => <i key={`${person.userId}-${index}`} title={person.name}>{person.avatar || avatars[index]}</i>)}</div><span>{people.length} listening</span></div>
        <button className="secondary" onClick={copyInvite}>{copied ? <Check size={17} /> : <Share2 size={17} />}{copied ? "Copied" : "Invite"}</button>
        <div className="menu-wrap"><button className="icon-button" aria-label="Room options" aria-expanded={roomMenu} onClick={() => { setRoomMenu(!roomMenu); setQueueMenu(false); }}><MoreHorizontal /></button>{roomMenu && <div className="action-menu nav-menu"><button onClick={() => { setDnaOpen(true); setRoomMenu(false); }}><Dna />View Room DNA</button><button onClick={() => { void navigator.clipboard.writeText(room.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); setRoomMenu(false); }}><Copy />Copy room code</button><button onClick={() => { window.location.href = "/"; }}><LogOut />Leave room</button></div>}</div>
      </div>
    </header>

    <section className="room-content">
      <div className="listening-pane">
        <div className="room-heading"><a href="/" aria-label="Leave room"><ArrowLeft /></a><div><div className="live-label"><i /> LIVE ROOM · {room.code}</div><h1>{room.name}</h1></div></div>
        <div className="now-card">
          <div className="video-stage">
            {current ? <YouTubePlayer key={current.id} track={current} room={room} volume={volume} onEnded={() => skip(1)} /> : <div className="empty-record"><ListMusic /><span>Add the first song</span></div>}
            <div className="stage-vignette" />
            <div className="moment-burst-layer">{momentBursts.filter((moment) => moment.trackId === current?.id).map((moment, index) => <span key={moment.id} style={{ "--burst-x": `${18 + index * 16}%` } as React.CSSProperties}><b>{moment.emoji}</b><small>{moment.name}</small></span>)}</div>
            <button className={`heart-button ${liked ? "liked" : ""}`} onClick={() => setLiked(!liked)} aria-label="Like song"><Heart fill={liked ? "currentColor" : "none"} /></button>
            {current && <div className="source-badge">YOUTUBE</div>}
          </div>
          <div className="track-info"><div><span className="now-label">NOW PLAYING</span><h2>{current?.title || "The room is quiet"}</h2><p>{current?.artist || "Paste a YouTube link to get started"}</p></div>{current && <a href={current.url} target="_blank" rel="noreferrer" className="icon-button" aria-label="Open source"><Link2 /></a>}</div>
          <PlaybackProgress room={room} current={current} onSeek={(position) => current && setPlayback(current, room.isPlaying, position)} />
          <div className="main-controls"><button className="control-small" onClick={() => skip(-1)} disabled={!current}><SkipBack fill="currentColor" /></button><button className="play-button" onClick={() => setPlayback(current, !room.isPlaying, effectivePosition(room))} disabled={!current}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button className="control-small" onClick={() => skip(1)} disabled={!current}><SkipForward fill="currentColor" /></button></div>
          <div className="volume-row"><Volume2 size={17} /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} style={{ "--progress": `${volume}%` } as React.CSSProperties} /></div>
        </div>

        <form className="add-bar" onSubmit={addTrack}><span className="provider-icon">▶</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a YouTube link to add a song…" aria-label="YouTube URL" /><button disabled={adding || !url}><Plus size={19} />{adding ? "Adding…" : "Add to queue"}</button></form>
        {error && <div className="inline-error"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        <div className="quick-reactions"><span>Mark this moment</span>{reactionChoices.map((emoji) => <button key={emoji} disabled={!current} onClick={(event) => react(emoji, event.currentTarget)}>{emoji}</button>)}</div>
        {currentMoments.length > 0 && <div className="moment-strip"><span><Sparkles /> Moments</span>{currentMoments.map((moment) => <button key={moment.id} title={`${moment.name} reacted at ${formatTime(moment.position)}`} onClick={() => current && setPlayback(current, true, moment.position)}>{moment.emoji}<small>{formatTime(moment.position)}</small></button>)}</div>}
      </div>

      <aside className="queue-pane">
        <div className="queue-header"><div><span>FAIR QUEUE</span><h2>Room queue <small>{orderedTracks.length}</small></h2></div><div className="menu-wrap"><button className="icon-button" aria-label="Queue options" aria-expanded={queueMenu} onClick={() => { setQueueMenu(!queueMenu); setRoomMenu(false); }}><MoreHorizontal /></button>{queueMenu && <div className="action-menu queue-menu"><button onClick={() => { socket?.emit("room:settings", { autopilotEnabled: !room.autopilotEnabled }); setQueueMenu(false); }}><WandSparkles />DJ Autopilot <i className={room.autopilotEnabled ? "toggle on" : "toggle"} /></button><button onClick={() => { setFairInfoOpen(true); setQueueMenu(false); }}><Info />How Fair Queue works</button><button onClick={copyQueue}><Copy />Copy queue</button></div>}</div></div>
        {room.autopilotEnabled && <div className="autopilot-banner"><WandSparkles /><div><strong>DJ Autopilot is on</strong><span>Crowd favorites return only after fresh picks run out.</span></div><button onClick={() => socket?.emit("room:settings", { autopilotEnabled: false })}><X /></button></div>}
        <label className="queue-search"><Search size={17} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search queue" /></label>
        <div className="queue-list">
          {filteredTracks.map((track) => {
            const active = track.id === current?.id;
            const queueIndex = orderedTracks.findIndex((item) => item.id === track.id);
            const pendingIndex = orderedTracks.filter((item) => item.id !== current?.id).findIndex((item) => item.id === track.id);
            const pendingCount = orderedTracks.filter((item) => item.id !== current?.id).length;
            return <article key={track.id} className={`queue-item ${active ? "active" : ""}`}>
              <button className="queue-thumb" onClick={() => setPlayback(track, true, 0)} aria-label={`Play ${track.title}`}><img src={track.thumbnail || ""} alt="" /><span>{active && room.isPlaying ? <i className="equalizer"><b /><b /><b /></i> : <Play size={15} fill="currentColor" />}</span></button>
              <div className="queue-meta"><strong>{track.title}</strong><span>{track.artist}</span><small>{active ? "Playing now" : `Fair position ${queueIndex + 1}`} · Added by {track.addedBy}</small></div>
              <div className="queue-actions"><button className={votedTrackIds.has(track.id) ? "voted" : ""} onClick={() => vote(track.id)} disabled={votedTrackIds.has(track.id)} title={votedTrackIds.has(track.id) ? "Already voted" : "Vote up"}><Heart size={14} fill={votedTrackIds.has(track.id) ? "currentColor" : "none"} />{track.votes || ""}</button><button onClick={() => move(track, -1)} disabled={active || pendingIndex <= 0} title="Move up"><ArrowUp size={14} /></button><button onClick={() => move(track, 1)} disabled={active || pendingIndex < 0 || pendingIndex === pendingCount - 1} title="Move down"><ArrowDown size={14} /></button><button onClick={() => socket?.emit("queue:remove", { trackId: track.id })} title="Remove"><Trash2 size={14} /></button></div>
            </article>;
          })}
          {!filteredTracks.length && <div className="queue-empty"><ListMusic /><strong>{filter ? "No matches" : "Your queue is empty"}</strong><span>{filter ? "Try another search." : "Paste a link to start the music."}</span></div>}
        </div>
        <div className="queue-footer"><RotateCw size={15} /><span>{room.autopilotEnabled ? "Autopilot will keep this session moving" : orderedTracks.length ? `${orderedTracks.length - 1} fair picks coming up` : "Ready for a song"}</span></div>
      </aside>
    </section>

    {current && <div className="mobile-player"><img src={current.thumbnail || ""} alt="" /><div><strong>{current.title}</strong><span>{current.artist}</span></div><button onClick={() => setPlayback(current, !room.isPlaying, effectivePosition(room))}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button onClick={() => skip(1)}><ChevronRight /></button></div>}

    {dnaOpen && <FeatureModal title="Room DNA" icon={<Dna />} onClose={() => setDnaOpen(false)}><div className="dna-hero"><span>TONIGHT’S VIBE</span><strong>{roomDna.vibe}</strong><p>Built live from what this room plays, loves, and reacts to.</p></div><div className="dna-bars">{[["Energy", roomDna.energy], ["Discovery", roomDna.discovery], ["Togetherness", roomDna.togetherness], ["Crowd love", roomDna.love]].map(([label, value]) => <div key={String(label)}><span>{label}<b>{value}%</b></span><i><em style={{ width: `${value}%` }} /></i></div>)}</div><div className="dna-stats"><div><span>Top artist</span><strong>{roomDna.topArtist}</strong></div><div><span>Chief contributor</span><strong>{roomDna.topContributor}</strong></div><div><span>Shared by</span><strong>{roomDna.contributors} music minds</strong></div></div><button className="primary modal-action" onClick={shareDna}><Share2 />{copied ? "DNA copied" : "Share this Room DNA"}</button></FeatureModal>}
    {fairInfoOpen && <FeatureModal title="Fair Queue" icon={<Sparkles />} onClose={() => setFairInfoOpen(false)}><div className="fair-explainer"><div><b>1</b><span><strong>Everyone gets a turn</strong>Contributors rotate before one person can play twice.</span></div><div><b>2</b><span><strong>Votes still matter</strong>Votes choose which of that contributor’s songs leads their turn.</span></div><div><b>3</b><span><strong>No stale repeats</strong>Played songs leave the fresh queue. Autopilot revives favorites only when it runs dry.</span></div></div></FeatureModal>}
  </main>;
}
