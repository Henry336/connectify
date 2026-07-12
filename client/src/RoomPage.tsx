import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Copy, Dna, EyeOff, Gamepad2, Heart, History, Info, Library, Link2, ListMusic, ListPlus, Lock, LogOut, Maximize2, MessageCircle, MoreHorizontal, Palette, Pause, Play, Plus, Radio, RotateCw, Search, Send, Share2, ShieldCheck, SkipBack, SkipForward, Sparkles, Trash2, Undo2, UserMinus, Users, Volume2, WandSparkles, Wifi, WifiOff, X, Youtube } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL } from "./api";
import { getHostToken, getIdentity, rememberRoom, saveHostToken } from "./identity";
import { effectivePosition, withReceipt } from "./playback";
import type { ChatMessage, Moment, PartyMode, Person, Room, RoomTheme, SearchItem, Track } from "./types";
import { YouTubePlayer } from "./YouTubePlayer";

const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const avatars = ["🌻", "🪩", "🎧", "🌙", "🛼", "✨"];
const reactionChoices = ["🔥", "💜", "🥹", "🕺", "✨"] as const;
const isYouTubeUrl = (value: string) => /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i.test(value.trim());
const partyModes: Array<{ id: PartyMode; name: string; description: string }> = [
  { id: "standard", name: "Standard", description: "Fair shared queue with normal room controls." },
  { id: "pass_aux", name: "Pass the AUX", description: "Contributor turns are highlighted and rotated." },
  { id: "blind_pick", name: "Blind Pick", description: "Upcoming song identities stay hidden until they play." },
  { id: "one_take", name: "One Take", description: "No manual skipping once a song starts." },
  { id: "discovery", name: "Discovery Night", description: "Each artist can appear only once in the room." },
  { id: "watch_party", name: "Watch Party", description: "Theater layout, remote sync health, and timestamped group chat." },
];
const modeName = (mode: PartyMode) => partyModes.find((item) => item.id === mode)?.name || "Standard";

function PlaybackProgress({ room, current, onSeek }: { room: Room; current: Track | null; onSeek: (position: number) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!room.isPlaying) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [room.isPlaying]);
  const elapsed = effectivePosition(room, now);
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
  const [partyOpen, setPartyOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [role, setRole] = useState<"host" | "guest">("guest");
  const [momentBursts, setMomentBursts] = useState<Moment[]>([]);
  const [placement, setPlacement] = useState<"last" | "next">("last");
  const [sideTab, setSideTab] = useState<"queue" | "chat">("queue");
  const [chatBody, setChatBody] = useState("");
  const [chatSpoiler, setChatSpoiler] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(() => new Set());
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [syncHealth, setSyncHealth] = useState({ drift: 0, correcting: false, buffering: false });
  const [removedTrack, setRemovedTrack] = useState<{ trackId: string; title: string } | null>(null);
  const [localResults, setLocalResults] = useState<SearchItem[]>([]);
  const [youtubeResults, setYoutubeResults] = useState<SearchItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [lastSearch, setLastSearch] = useState("");
  const [liveCached, setLiveCached] = useState(false);

  useEffect(() => {
    let active = true;
    api<Room>(`/api/rooms/${code}`).then((data) => { if (active) { const received = withReceipt(data); rememberRoom(data.code, data.name); setRoom((previous) => !previous || data.revision >= previous.revision ? received : previous); } }).catch((err) => setError(err.message));
    const connection = io(API_URL, { transports: ["websocket", "polling"] });
    connection.on("connect", () => { setConnectionState("connected"); connection.emit("room:join", { code, ...identity, hostToken: getHostToken(code) }, (result: { ok: boolean; role?: "host" | "guest"; hostToken?: string; error?: string }) => {
      if (!result?.ok) { setRoom(null); setError(result?.error || "Could not join this room."); connection.disconnect(); return; }
      setRole(result.role || "guest");
      if (result.hostToken) saveHostToken(code, result.hostToken);
    }); });
    connection.on("disconnect", () => setConnectionState("reconnecting"));
    connection.io.on("reconnect_attempt", () => setConnectionState("reconnecting"));
    connection.on("room:snapshot", (snapshot: Room) => { const received = withReceipt(snapshot); setRoom((previous) => !previous || snapshot.revision >= previous.revision ? received : previous); });
    connection.on("room:presence", setPeople);
    connection.on("queue:votes", (ids: string[]) => setVotedTrackIds(new Set(ids)));
    connection.on("queue:vote-updated", ({ trackId, votes }: { trackId: string; votes: number }) => setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.map((track) => track.id === trackId ? { ...track, votes } : track) } : previous));
    connection.on("room:moment", (moment: Moment) => {
      setRoom((previous) => previous ? { ...previous, moments: [...previous.moments, moment].slice(-60) } : previous);
      setMomentBursts((previous) => [...previous, moment].slice(-5));
      window.setTimeout(() => setMomentBursts((previous) => previous.filter((item) => item.id !== moment.id)), 2600);
    });
    connection.on("room:chat", (message: ChatMessage) => setRoom((previous) => previous ? { ...previous, messages: [...previous.messages, message].slice(-100) } : previous));
    connection.on("queue:removed", (removed: { trackId: string; title: string }) => { setRemovedTrack(removed); window.setTimeout(() => setRemovedTrack((current) => current?.trackId === removed.trackId ? null : current), 8000); });
    connection.on("room:kicked", () => { window.alert("The host removed you from this room."); window.location.href = "/"; });
    setSocket(connection);
    return () => { active = false; connection.disconnect(); };
  }, [code]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".menu-wrap")) { setRoomMenu(false); setQueueMenu(false); } };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    const query = url.trim();
    if (query.length < 2 || isYouTubeUrl(query)) { setLocalResults([]); if (!query) setSearchOpen(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ items: SearchItem[] }>(`/api/search/local?q=${encodeURIComponent(query)}&code=${code}`, { signal: controller.signal })
        .then((result) => { setLocalResults(result.items); if (result.items.length) setSearchOpen(true); })
        .catch((reason) => { if (reason?.name !== "AbortError") console.warn("Local search failed", reason); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [url, code]);

  const current = room?.tracks.find((track) => track.id === room.currentTrackId) ?? null;
  const isHost = role === "host";
  const canControl = isHost || Boolean(room?.guestsCanControl);
  const canAdd = isHost || Boolean(room?.guestsCanAdd);
  const orderedTracks = useMemo(() => room?.queueOrder.map((id) => room.tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)) ?? [], [room]);
  const filteredTracks = useMemo(() => orderedTracks.filter((track) => {
    const blind = room?.partyMode === "blind_pick" && track.id !== room.currentTrackId;
    return `${blind ? "Mystery pick" : `${track.title} ${track.artist}`} ${track.addedBy}`.toLowerCase().includes(filter.toLowerCase());
  }), [orderedTracks, filter, room?.partyMode, room?.currentTrackId]);
  const currentMoments = useMemo(() => room?.moments.filter((moment) => moment.trackId === current?.id).slice(-6).reverse() ?? [], [room?.moments, current?.id]);
  const playedTracks = useMemo(() => room?.tracks.filter((track) => track.playedAt).sort((a, b) => new Date(b.playedAt!).getTime() - new Date(a.playedAt!).getTime()) ?? [], [room?.tracks]);
  const etaByTrack = useMemo(() => {
    const result = new Map<string, number>();
    let elapsed = 0;
    for (const track of orderedTracks) {
      result.set(track.id, elapsed);
      elapsed += track.id === current?.id ? Math.max(0, (track.duration || 240) - (room ? effectivePosition(room) : 0)) : (track.duration || 240);
    }
    return result;
  }, [orderedTracks, current?.id, room?.revision, syncHealth.drift]);
  const queueDuration = useMemo(() => {
    const last = orderedTracks[orderedTracks.length - 1];
    return last ? (etaByTrack.get(last.id) || 0) + (last.duration || 240) : 0;
  }, [orderedTracks, etaByTrack]);
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

  const setPlayback = useCallback((track: Track | null, isPlaying: boolean, position = 0) => { if (track && canControl) socket?.emit("playback:set", { trackId: track.id, isPlaying, position }); }, [socket, canControl]);
  const skip = useCallback((direction: -1 | 1, reason: "manual" | "ended" = "manual") => { if (current && (reason === "ended" || canControl)) socket?.emit("playback:advance", { trackId: current.id, direction, reason }); }, [current, socket, canControl]);
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
  const addUrl = async (targetUrl: string, targetPlacement: "last" | "next" = placement) => {
    if (!targetUrl.trim()) return;
    setAdding(true); setError("");
    try {
      await api(`/api/rooms/${code}/tracks`, { method: "POST", body: JSON.stringify({ url: targetUrl, addedBy: identity.name, userId: identity.userId, hostToken: getHostToken(code), placement: targetPlacement }) });
      setUrl(""); setPlacement("last"); setSearchOpen(false); setLocalResults([]); setYoutubeResults([]); setNextPageToken(null); setSearchError("");
    }
    catch (err) { setError(err instanceof Error ? err.message : "Could not add that track."); }
    finally { setAdding(false); }
  };
  const searchYouTube = async (loadMore = false) => {
    const query = loadMore ? lastSearch : url.trim();
    if (query.length < 2) return;
    loadMore ? setLoadingMore(true) : setSearching(true);
    setSearchOpen(true); setSearchError("");
    try {
      const pageToken = loadMore && nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : "";
      const result = await api<{ items: SearchItem[]; nextPageToken: string | null; cached: boolean }>(`/api/search/youtube?q=${encodeURIComponent(query)}${pageToken}`);
      setYoutubeResults((previous) => loadMore ? [...new Map([...previous, ...result.items].map((item) => [item.providerId, item])).values()] : result.items);
      setNextPageToken(result.nextPageToken); setLastSearch(query); setLiveCached(result.cached);
    } catch (err) {
      if (!loadMore) setYoutubeResults([]);
      setSearchError(err instanceof Error ? err.message : "Live YouTube search is unavailable. You can still paste a URL.");
    } finally { setSearching(false); setLoadingMore(false); }
  };
  const submitComposer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    if (isYouTubeUrl(url)) void addUrl(url);
    else void searchYouTube(false);
  };
  const copyInvite = async () => { await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const move = (track: Track, delta: number) => {
    const ids = orderedTracks.filter((item) => item.id !== current?.id).map((item) => item.id); const from = ids.indexOf(track.id); const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]]; socket?.emit("queue:reorder", { trackIds: ids });
  };
  const copyQueue = async () => { await navigator.clipboard.writeText(orderedTracks.map((track, index) => `${index + 1}. ${room?.partyMode === "blind_pick" && track.id !== room.currentTrackId ? `Mystery pick by ${track.addedBy}` : `${track.title} — ${track.artist}`}`).join("\n") || "Connectify queue is empty"); setQueueMenu(false); };
  const shareDna = async () => { await navigator.clipboard.writeText(`${room?.name || "Our room"} is a ${roomDna.vibe.toLowerCase()} — ${roomDna.contributors} contributors, ${roomDna.topArtist} on repeat, ${roomDna.love}% crowd love. ${window.location.href}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const updateSettings = (settings: Partial<Pick<Room, "autopilotEnabled" | "partyMode" | "theme" | "isLocked" | "guestsCanControl" | "guestsCanAdd" | "maxSongsPerUser" | "discoverable">>) => socket?.emit("room:settings", settings, (result: { ok: boolean; error?: string }) => { if (!result?.ok) setError(result?.error || "Could not update the room."); });
  const kickMember = (memberId: string, name: string) => { if (window.confirm(`Remove ${name} and prevent them from rejoining?`)) socket?.emit("room:kick", { memberId }); };
  const clearQueue = () => { if (window.confirm("Clear the entire queue and listening history?")) socket?.emit("queue:clear", {}, () => setQueueMenu(false)); };
  const sendChat = (event: React.FormEvent) => {
    event.preventDefault(); if (!chatBody.trim() || !socket) return;
    socket.emit("room:chat", { body: chatBody, spoiler: chatSpoiler, trackId: current?.id || null, position: room ? effectivePosition(room) : null }, (result: { ok: boolean; error?: string }) => {
      if (result?.ok) { setChatBody(""); setChatSpoiler(false); }
      else setError(result?.error || "Could not send that message.");
    });
  };
  const resyncEveryone = () => { if (current && room && canControl) setPlayback(current, room.isPlaying, effectivePosition(room)); };
  const jumpToMessage = (message: ChatMessage) => {
    const track = room?.tracks.find((item) => item.id === message.trackId);
    if (track && message.position !== null) setPlayback(track, true, message.position);
  };
  const enterFullscreen = () => { void document.querySelector<HTMLElement>(".video-stage")?.requestFullscreen?.(); };

  useEffect(() => {
    if (sideTab !== "chat") return;
    const list = document.querySelector<HTMLElement>(".chat-list");
    if (list) list.scrollTop = list.scrollHeight;
  }, [room?.messages.length, sideTab]);

  if (!room) return <main className="room-loading"><a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a><div className="loading-record" />{error ? <><h2>{error}</h2><a href="/">Go back home</a></> : <p>Tuning in to {code}…</p>}</main>;

  return <main className={`room-shell theme-${room.theme} ${room.partyMode === "watch_party" ? "watch-party" : ""}`}>
    <header className="room-nav">
      <a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a>
      <div className="room-title-mobile"><strong>{room.name}</strong><span><i /> Live</span></div>
      <div className="room-nav-actions">
        <div className="listeners"><div className="avatar-stack">{people.slice(0, 4).map((person, index) => <i key={person.id} title={`${person.name}${person.role === "host" ? " · Host" : ""}`}>{person.avatar || avatars[index]}</i>)}</div><span>{people.length} listening</span></div>
        <button className={`sync-pill ${connectionState !== "connected" || syncHealth.buffering ? "waiting" : syncHealth.correcting ? "correcting" : ""}`} onClick={resyncEveryone} disabled={!isHost || !current} title={isHost ? "Resync everyone" : "Playback synchronization health"}>{connectionState === "connected" ? <Wifi /> : <WifiOff />}<span>{connectionState !== "connected" ? "Reconnecting" : syncHealth.buffering ? "Buffering" : syncHealth.correcting ? "Correcting" : `In sync · ${Math.abs(syncHealth.drift).toFixed(1)}s`}</span></button>
        <button className="secondary" onClick={copyInvite}>{copied ? <Check size={17} /> : <Share2 size={17} />}{copied ? "Copied" : "Invite"}</button>
        <div className="menu-wrap"><button className="icon-button" aria-label="Room options" aria-expanded={roomMenu} onClick={() => { setRoomMenu(!roomMenu); setQueueMenu(false); }}><MoreHorizontal /></button>{roomMenu && <div className="action-menu nav-menu"><button onClick={() => { setDnaOpen(true); setRoomMenu(false); }}><Dna />View Room DNA</button><button onClick={() => { setMembersOpen(true); setRoomMenu(false); }}><Users />Room profile</button>{isHost && <button onClick={() => { setHostOpen(true); setRoomMenu(false); }}><ShieldCheck />Host controls</button>}<button onClick={() => { void navigator.clipboard.writeText(room.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); setRoomMenu(false); }}><Copy />Copy room code</button><button onClick={() => { window.location.href = "/"; }}><LogOut />Leave room</button></div>}</div>
      </div>
    </header>

    <section className="room-content">
      <div className="listening-pane">
        <div className="room-heading"><a href="/" aria-label="Leave room"><ArrowLeft /></a><div><div className="live-label"><i /> LIVE ROOM · {room.code} · {modeName(room.partyMode).toUpperCase()}</div><h1>{room.name}</h1></div></div>
        {room.partyMode !== "standard" && <div className="party-mode-banner"><Gamepad2 /><div><strong>{modeName(room.partyMode)}</strong><span>{partyModes.find((mode) => mode.id === room.partyMode)?.description}</span></div>{isHost && <button onClick={() => setPartyOpen(true)}>Change</button>}</div>}
        <div className="now-card">
          <div className="video-stage">
            {current ? <YouTubePlayer key={current.id} track={current} room={room} volume={volume} onEnded={() => skip(1, "ended")} onDuration={(duration) => socket?.emit("track:duration", { trackId: current.id, duration })} onSync={setSyncHealth} /> : <div className="empty-record"><ListMusic /><span>Add the first song</span></div>}
            <div className="stage-vignette" />
            <div className="moment-burst-layer">{momentBursts.filter((moment) => moment.trackId === current?.id).map((moment, index) => <span key={moment.id} style={{ "--burst-x": `${18 + index * 16}%` } as React.CSSProperties}><b>{moment.emoji}</b><small>{moment.name}</small></span>)}</div>
            <button className={`heart-button ${liked ? "liked" : ""}`} onClick={() => setLiked(!liked)} aria-label="Like song"><Heart fill={liked ? "currentColor" : "none"} /></button>
            {current && <div className="source-badge">YOUTUBE</div>}
          </div>
          <div className="track-info"><div><span className="now-label">NOW PLAYING</span><h2>{current?.title || "The room is quiet"}</h2><p>{current?.artist || "Paste a YouTube link to get started"}</p></div>{current && <div className="track-info-actions">{room.partyMode === "watch_party" && <button className="icon-button" onClick={enterFullscreen} aria-label="Enter full-screen theater"><Maximize2 /></button>}<a href={current.url} target="_blank" rel="noreferrer" className="icon-button" aria-label="Open source"><Link2 /></a></div>}</div>
          <PlaybackProgress room={room} current={current} onSeek={(position) => current && setPlayback(current, room.isPlaying, position)} />
          <div className="main-controls"><button className="control-small" onClick={() => skip(-1)} disabled={!current || !canControl || room.partyMode === "one_take"}><SkipBack fill="currentColor" /></button><button className="play-button" onClick={() => setPlayback(current, !room.isPlaying, effectivePosition(room))} disabled={!current || !canControl}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button className="control-small" onClick={() => skip(1)} disabled={!current || !canControl || room.partyMode === "one_take"}><SkipForward fill="currentColor" /></button></div>
          <div className="volume-row"><Volume2 size={17} /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} style={{ "--progress": `${volume}%` } as React.CSSProperties} /></div>
        </div>

        <div className="search-shell">
          <form className="add-bar search-bar" onSubmit={submitComposer}><span className="provider-icon"><Search /></span><input type="text" value={url} onChange={(event) => setUrl(event.target.value)} onFocus={() => url.trim().length >= 2 && !isYouTubeUrl(url) && setSearchOpen(true)} placeholder={canAdd ? "Search music or videos, or paste a YouTube URL…" : "The host paused guest submissions"} aria-label="Search or paste a YouTube URL" disabled={!canAdd} autoComplete="off" />{canControl && <select value={placement} onChange={(event) => setPlacement(event.target.value as "last" | "next")} aria-label="Queue placement"><option value="last">Add last</option><option value="next">Play next</option></select>}<button disabled={adding || searching || !url.trim() || !canAdd}>{isYouTubeUrl(url) ? placement === "next" ? <ListPlus size={19} /> : <Plus size={19} /> : <Search size={19} />}{adding ? "Adding…" : searching ? "Searching…" : isYouTubeUrl(url) ? placement === "next" ? "Play next" : "Add to queue" : "Search YouTube"}</button></form>
          {searchOpen && !isYouTubeUrl(url) && <section className="search-results" aria-live="polite">
            <header><div><strong>Find something to play</strong><span>Library results are instant. Live YouTube search uses cached results whenever possible.</span></div><button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X /></button></header>
            {localResults.length > 0 && <div className="search-group"><div className="search-group-title"><Library /><strong>Connectify Library</strong><span>{localResults.length} matches</span></div><div className="search-grid">{localResults.map((item) => <SearchResult key={`local-${item.providerId}`} item={item} canControl={canControl} adding={adding} onAdd={addUrl} />)}</div></div>}
            {(searching || youtubeResults.length > 0 || searchError) && <div className="search-group"><div className="search-group-title"><Youtube /><strong>Live YouTube</strong>{liveCached && !searching && <span>Cached</span>}</div>{searching ? <div className="search-loading"><i /><span>Searching YouTube…</span></div> : <><div className="search-grid">{youtubeResults.map((item) => <SearchResult key={`youtube-${item.providerId}`} item={item} canControl={canControl} adding={adding} onAdd={addUrl} />)}</div>{searchError && <div className="search-error"><span>{searchError}</span><small>Paste a YouTube URL above to keep going.</small></div>}{nextPageToken && <button className="load-more" onClick={() => void searchYouTube(true)} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load 25 more results"}</button>}<p className="youtube-attribution">Results provided by YouTube. By using live search, you agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>.</p></>}</div>}
            {!searching && localResults.length === 0 && youtubeResults.length === 0 && !searchError && <div className="search-prompt"><Search /><strong>Search the wider catalog</strong><span>Press Enter or choose “Search YouTube.” Results load 25 at a time, and you can keep loading more.</span></div>}
          </section>}
        </div>
        {error && <div className="inline-error"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        <div className="quick-reactions"><span>Mark this moment</span>{reactionChoices.map((emoji) => <button key={emoji} disabled={!current} onClick={(event) => react(emoji, event.currentTarget)}>{emoji}</button>)}</div>
        {currentMoments.length > 0 && <div className="moment-strip"><span><Sparkles /> Moments</span>{currentMoments.map((moment) => <button key={moment.id} title={`${moment.name} reacted at ${formatTime(moment.position)}`} onClick={() => current && setPlayback(current, true, moment.position)}>{moment.emoji}<small>{formatTime(moment.position)}</small></button>)}</div>}
      </div>

      <aside className="queue-pane">
        <div className="queue-header"><div><span>{room.partyMode === "pass_aux" ? "PASS THE AUX" : "FAIR QUEUE"}</span><h2>Room queue <small>{orderedTracks.length}</small></h2></div><div className="menu-wrap"><button className="icon-button" aria-label="Queue options" aria-expanded={queueMenu} onClick={() => { setQueueMenu(!queueMenu); setRoomMenu(false); }}><MoreHorizontal /></button>{queueMenu && <div className="action-menu queue-menu">{isHost && <button onClick={() => { setPartyOpen(true); setQueueMenu(false); }}><Gamepad2 />Party mode</button>}{isHost && <button onClick={() => { updateSettings({ autopilotEnabled: !room.autopilotEnabled }); setQueueMenu(false); }}><WandSparkles />DJ Autopilot <i className={room.autopilotEnabled ? "toggle on" : "toggle"} /></button>}<button onClick={() => { setHistoryOpen(true); setQueueMenu(false); }}><History />Listening history</button><button onClick={() => { setFairInfoOpen(true); setQueueMenu(false); }}><Info />How Fair Queue works</button><button onClick={copyQueue}><Copy />Copy queue</button>{isHost && <button onClick={clearQueue}><Trash2 />Clear room queue</button>}</div>}</div></div>
        {room.partyMode === "watch_party" && <div className="watch-tabs"><button className={sideTab === "queue" ? "active" : ""} onClick={() => setSideTab("queue")}><ListMusic />Queue</button><button className={sideTab === "chat" ? "active" : ""} onClick={() => setSideTab("chat")}><MessageCircle />Chat <small>{room.messages.length || ""}</small></button></div>}
        {(room.partyMode !== "watch_party" || sideTab === "queue") && <>{room.autopilotEnabled && <div className="autopilot-banner"><WandSparkles /><div><strong>DJ Autopilot is on</strong><span>Crowd favorites return only after fresh picks run out.</span></div>{isHost && <button onClick={() => updateSettings({ autopilotEnabled: false })}><X /></button>}</div>}
        <label className="queue-search"><Search size={17} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search queue" /></label>
        <div className="queue-list">
          {filteredTracks.map((track) => {
            const active = track.id === current?.id;
            const blind = room.partyMode === "blind_pick" && !active;
            const queueIndex = orderedTracks.findIndex((item) => item.id === track.id);
            const pendingIndex = orderedTracks.filter((item) => item.id !== current?.id).findIndex((item) => item.id === track.id);
            const pendingCount = orderedTracks.filter((item) => item.id !== current?.id).length;
            return <article key={track.id} className={`queue-item ${active ? "active" : ""}`}>
              <button className={`queue-thumb ${blind ? "blind" : ""}`} onClick={() => setPlayback(track, true, 0)} disabled={!canControl || blind} aria-label={blind ? "Hidden Blind Pick" : `Play ${track.title}`}>{blind ? <EyeOff /> : <img src={track.thumbnail || ""} alt="" />}<span>{active && room.isPlaying ? <i className="equalizer"><b /><b /><b /></i> : <Play size={15} fill="currentColor" />}</span></button>
              <div className="queue-meta"><strong>{blind ? "Mystery pick" : track.title}</strong><span>{blind ? "Revealed when it starts" : track.artist}</span><small>{active ? "Playing now" : track.playNext ? "Pinned to play next" : `Starts in ~${Math.max(1, Math.round((etaByTrack.get(track.id) || 0) / 60))} min`} · Added by {track.addedBy}</small></div>
              <div className="queue-actions"><button className={votedTrackIds.has(track.id) ? "voted" : ""} onClick={() => vote(track.id)} disabled={votedTrackIds.has(track.id)} title={votedTrackIds.has(track.id) ? "Already voted" : "Vote up"}><Heart size={14} fill={votedTrackIds.has(track.id) ? "currentColor" : "none"} />{track.votes || ""}</button><button onClick={() => move(track, -1)} disabled={!canControl || active || pendingIndex <= 0} title="Move up"><ArrowUp size={14} /></button><button onClick={() => move(track, 1)} disabled={!canControl || active || pendingIndex < 0 || pendingIndex === pendingCount - 1} title="Move down"><ArrowDown size={14} /></button><button onClick={() => socket?.emit("queue:remove", { trackId: track.id })} disabled={!canControl || (room.partyMode === "one_take" && active)} title="Remove"><Trash2 size={14} /></button></div>
            </article>;
          })}
          {!filteredTracks.length && <div className="queue-empty"><ListMusic /><strong>{filter ? "No matches" : "Your queue is empty"}</strong><span>{filter ? "Try another search." : "Paste a link to start the music."}</span></div>}
        </div>
        <div className="queue-footer"><RotateCw size={15} /><span>{room.autopilotEnabled ? "Autopilot will keep this session moving" : orderedTracks.length ? `${orderedTracks.length - 1} upcoming · about ${Math.max(1, Math.round(queueDuration / 60))} min` : "Ready for a song"}</span></div></>}
        {room.partyMode === "watch_party" && sideTab === "chat" && <div className="watch-chat"><div className="chat-list">{room.messages.length ? room.messages.map((message) => { const hidden = message.spoiler && !revealedSpoilers.has(message.id); const messageTrackExists = room.tracks.some((track) => track.id === message.trackId); return <article key={message.id}><i>{message.avatar}</i><div><header><strong>{message.name}</strong>{message.position !== null && <button disabled={!canControl || !messageTrackExists} onClick={() => jumpToMessage(message)}>{formatTime(message.position)}</button>}</header>{hidden ? <button className="spoiler-message" onClick={() => setRevealedSpoilers((previous) => new Set(previous).add(message.id))}>Spoiler hidden · reveal</button> : <p>{message.body}</p>}</div></article>; }) : <div className="chat-empty"><MessageCircle /><strong>The couch is quiet</strong><span>Start the conversation. Messages can stay attached to this exact video moment.</span></div>}</div><form className="chat-compose" onSubmit={sendChat}><textarea value={chatBody} onChange={(event) => setChatBody(event.target.value)} maxLength={300} placeholder="Say something about this moment…" /><div><label><input type="checkbox" checked={chatSpoiler} onChange={(event) => setChatSpoiler(event.target.checked)} /> Hide as spoiler</label><button disabled={!chatBody.trim()}><Send /></button></div></form></div>}
      </aside>
    </section>

    {current && <div className="mobile-player"><img src={current.thumbnail || ""} alt="" /><div><strong>{current.title}</strong><span>{current.artist}</span></div><button disabled={!canControl} onClick={() => setPlayback(current, !room.isPlaying, effectivePosition(room))}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button disabled={!canControl || room.partyMode === "one_take"} onClick={() => skip(1)}><ChevronRight /></button></div>}
    {removedTrack && <div className="undo-toast"><span><Trash2 />Removed “{removedTrack.title}”</span><button onClick={() => socket?.emit("queue:undo", { trackId: removedTrack.trackId }, (result: { ok: boolean }) => { if (result?.ok) setRemovedTrack(null); })}><Undo2 />Undo</button></div>}

    {dnaOpen && <FeatureModal title="Room DNA" icon={<Dna />} onClose={() => setDnaOpen(false)}><div className="dna-hero"><span>TONIGHT’S VIBE</span><strong>{roomDna.vibe}</strong><p>Built live from what this room plays, loves, and reacts to.</p></div><div className="dna-bars">{[["Energy", roomDna.energy], ["Discovery", roomDna.discovery], ["Togetherness", roomDna.togetherness], ["Crowd love", roomDna.love]].map(([label, value]) => <div key={String(label)}><span>{label}<b>{value}%</b></span><i><em style={{ width: `${value}%` }} /></i></div>)}</div><div className="dna-stats"><div><span>Top artist</span><strong>{roomDna.topArtist}</strong></div><div><span>Chief contributor</span><strong>{roomDna.topContributor}</strong></div><div><span>Shared by</span><strong>{roomDna.contributors} music minds</strong></div></div><button className="primary modal-action" onClick={shareDna}><Share2 />{copied ? "DNA copied" : "Share this Room DNA"}</button></FeatureModal>}
    {fairInfoOpen && <FeatureModal title="Fair Queue" icon={<Sparkles />} onClose={() => setFairInfoOpen(false)}><div className="fair-explainer"><div><b>1</b><span><strong>Everyone gets a turn</strong>Contributors rotate before one person can play twice.</span></div><div><b>2</b><span><strong>Votes still matter</strong>Votes choose which of that contributor’s songs leads their turn.</span></div><div><b>3</b><span><strong>No stale repeats</strong>Played songs leave the fresh queue. Autopilot revives favorites only when it runs dry.</span></div></div></FeatureModal>}
    {partyOpen && <FeatureModal title="Party Modes" icon={<Gamepad2 />} onClose={() => setPartyOpen(false)}><p className="modal-intro">Change the rules for everyone in this persistent room.</p><div className="party-grid">{partyModes.map((mode) => <button key={mode.id} className={room.partyMode === mode.id ? "active" : ""} disabled={!isHost} onClick={() => { updateSettings({ partyMode: mode.id }); setPartyOpen(false); }}><span>{mode.id === "blind_pick" ? <EyeOff /> : mode.id === "one_take" ? <Lock /> : mode.id === "discovery" ? <Sparkles /> : <Gamepad2 />}</span><strong>{mode.name}</strong><small>{mode.description}</small>{room.partyMode === mode.id && <Check />}</button>)}</div>{!isHost && <p className="permission-note">Only the host can change the active mode.</p>}</FeatureModal>}
    {membersOpen && <FeatureModal title="Room Profile" icon={<Users />} onClose={() => setMembersOpen(false)}><div className="room-profile-card"><span>PERMANENT ROOM</span><strong>{room.name}</strong><p>Room {room.code} · Created {new Date(room.createdAt).toLocaleDateString()}</p><button onClick={copyInvite}><Link2 />{copied ? "Link copied" : "Copy permanent room link"}</button></div><div className="profile-section"><h3><Users /> Members <small>{room.members.length}</small></h3><div className="member-list">{room.members.map((member) => <div key={member.id}><i>{member.avatar}</i><span><strong>{member.name}</strong><small>{member.role === "host" ? "Host" : `Last seen ${new Date(member.lastSeenAt).toLocaleDateString()}`}</small></span>{member.role === "host" && <b>HOST</b>}</div>)}</div></div><div className="profile-section"><h3><Palette /> Room theme</h3><div className="theme-picker">{(["violet", "sunset", "ocean", "mono"] as RoomTheme[]).map((theme) => <button key={theme} className={`${theme} ${room.theme === theme ? "active" : ""}`} disabled={!isHost} onClick={() => updateSettings({ theme })} title={theme}><i /></button>)}</div></div></FeatureModal>}
    {historyOpen && <FeatureModal title="Listening History" icon={<History />} onClose={() => setHistoryOpen(false)}>{playedTracks.length ? <div className="history-list">{playedTracks.map((track, index) => <button key={track.id} disabled={!canControl} onClick={() => { setPlayback(track, true, 0); setHistoryOpen(false); }}><span>{index + 1}</span><img src={track.thumbnail || ""} alt="" /><div><strong>{track.title}</strong><small>{track.artist} · Added by {track.addedBy}</small></div><Play /></button>)}</div> : <div className="modal-empty"><History /><strong>No listening history yet</strong><span>Finished and skipped songs will stay here for returning members.</span></div>}</FeatureModal>}
    {hostOpen && <FeatureModal title="Host Controls" icon={<ShieldCheck />} onClose={() => setHostOpen(false)}><p className="modal-intro">These rules are enforced by the room server.</p><div className="host-settings"><button onClick={() => updateSettings({ isLocked: !room.isLocked })}><span><Lock /><b>Lock room</b><small>Only returning members can join.</small></span><i className={room.isLocked ? "toggle on" : "toggle"} /></button><button onClick={() => updateSettings({ guestsCanControl: !room.guestsCanControl })}><span><Play /><b>Guest playback controls</b><small>Allow guests to play, seek, skip, and reorder.</small></span><i className={room.guestsCanControl ? "toggle on" : "toggle"} /></button><button onClick={() => updateSettings({ guestsCanAdd: !room.guestsCanAdd })}><span><Plus /><b>Guest song submissions</b><small>Allow guests to add URLs to the queue.</small></span><i className={room.guestsCanAdd ? "toggle on" : "toggle"} /></button><button onClick={() => updateSettings({ discoverable: !room.discoverable })}><span><Library /><b>Contribute to discovery</b><small>Let video metadata from this room appear in Connectify Library results. Room and member details stay private.</small></span><i className={room.discoverable ? "toggle on" : "toggle"} /></button><label><span><ListMusic /><b>Upcoming songs per guest</b><small>Prevents one listener from flooding the queue.</small></span><select value={room.maxSongsPerUser} onChange={(event) => updateSettings({ maxSongsPerUser: Number(event.target.value) })}>{[1,2,3,5,8,10,15,20].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="profile-section moderation"><h3><Users /> Member moderation</h3><div className="member-list">{room.members.map((member) => <div key={member.id}><i>{member.avatar}</i><span><strong>{member.name}</strong><small>{member.role === "host" ? "Room host" : "Returning member"}</small></span>{member.role === "guest" && <button onClick={() => kickMember(member.id, member.name)} title={`Remove ${member.name}`}><UserMinus /></button>}</div>)}</div></div></FeatureModal>}
  </main>;
}

function SearchResult({ item, canControl, adding, onAdd }: { item: SearchItem; canControl: boolean; adding: boolean; onAdd: (url: string, placement?: "last" | "next") => Promise<void> }) {
  return <article className="search-result">
    <img src={item.thumbnail || "/connectify.svg"} alt="" loading="lazy" />
    <div><strong>{item.title}</strong><span>{item.artist}</span><small>{item.source === "connectify" ? "Connectify Library" : "YouTube"}</small></div>
    <div className="search-result-actions"><button disabled={adding} onClick={() => void onAdd(item.url, "last")}><Plus />Add</button>{canControl && <button disabled={adding} onClick={() => void onAdd(item.url, "next")}><ListPlus />Next</button>}</div>
  </article>;
}
