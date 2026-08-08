import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowRight, Headphones, History, Link2, ListMusic, Radio, Sparkles } from "lucide-react";
import { api, waitForBackend } from "./api";
import { DEFAULT_IDENTITY, getIdentity, getRecentRooms, saveHostToken, saveIdentity, type Identity, type RecentRoom } from "./identity";
import { Brand } from "./Brand";
import { randomRoomName } from "./name-generator";

// Lazy so its stylesheet stays out of the prerender module graph, which runs in plain
// Node and cannot load CSS -- same reason WhatsNew is lazy.
const ChangelogHistory = lazy(() => import("./ChangelogHistory").then((module) => ({ default: module.ChangelogHistory })));

const roomDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function formatRoomDate(timestamp: number) {
  return roomDateFormatter.format(new Date(timestamp));
}

function formatLastVisited(timestamp: number) {
  const elapsedDays = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (elapsedDays <= 0) return "Opened today";
  if (elapsedDays === 1) return "Opened yesterday";
  return `Opened ${formatRoomDate(timestamp)}`;
}

export function Landing() {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [identity, setIdentity] = useState<Identity>(DEFAULT_IDENTITY);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [name, setName] = useState(DEFAULT_IDENTITY.name);
  const [roomName, setRoomName] = useState("Midnight listening room");
  const [maxParticipants, setMaxParticipants] = useState(50);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [waking, setWaking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedIdentity = getIdentity();
    setIdentity(savedIdentity);
    setName(savedIdentity.name);
    setRoomName(randomRoomName());
    setRecentRooms(getRecentRooms());
  }, []);

  const enter = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setBusy(true);
    const baseIdentity = identity.userId ? identity : getIdentity();
    const nextIdentity = { ...baseIdentity, name: name.trim() || baseIdentity.name };
    saveIdentity(nextIdentity);
    const wakingTimer = window.setTimeout(() => setWaking(true), 350);
    try {
      await waitForBackend();
      window.clearTimeout(wakingTimer);
      setWaking(false);
      if (mode === "create") {
        const room = await api<{ code: string; hostToken: string }>("/api/rooms", {
          method: "POST",
          body: JSON.stringify({ name: roomName, userId: nextIdentity.userId, maxParticipants }),
        });
        saveHostToken(room.code, room.hostToken);
        window.location.href = `/room/${room.code}`;
      } else {
        window.location.href = `/room/${code.toUpperCase()}`;
      }
    } catch (err) { window.clearTimeout(wakingTimer); setWaking(false); setError(err instanceof Error ? err.message : "Could not enter the room."); setBusy(false); }
  };

  return <main className="landing">
    <nav className="landing-nav">
      <Brand />
      <div className="landing-nav-actions">
        <button className="text-button" onClick={() => setChangelogOpen(true)}><History size={15} />What's new</button>
        <button className="text-button" onClick={() => { setMode("join"); document.querySelector(".room-card")?.scrollIntoView({ behavior: "smooth" }); }}>Join a room</button>
      </div>
    </nav>
    {changelogOpen && <Suspense fallback={null}><ChangelogHistory onClose={() => setChangelogOpen(false)} /></Suspense>}

    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={14} /> Music and watch parties, in sync</div>
        <h1>Good songs are<br /><em>better together.</em></h1>
        <p>Create a room, drop a YouTube link, and press play. Hear the same song or watch the same video together—wherever everyone is.</p>
        <button className="primary hero-action" onClick={() => document.querySelector(".room-card")?.scrollIntoView({ behavior: "smooth" })}>Start listening <ArrowRight size={18} /></button>
        <div className="trust-row"><span><Radio className="trust-signal" aria-hidden="true" /> No account needed</span><span>Free to start</span></div>
      </div>

      <div className="hero-visual" aria-hidden="true">
        <div className="orb orb-one" /><div className="orb orb-two" />
        <div className="mock-player-motion">
          <div className="mock-player">
            <div className="mock-top"><span>LIVE ROOM</span><div className="avatar-stack"><i>🌻</i><i>🪩</i><i>🎧</i><i>+3</i></div></div>
            <div className="mock-cover"><div className="vinyl"><div /></div></div>
            <div className="mock-song"><strong>Midnight Drive</strong><span>The Daydreamers</span></div>
            <div className="mock-wave">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ height: `${10 + ((i * 17) % 31)}px`, animationDelay: `${-((i * 83) % 1200)}ms` }} />)}</div>
            <div className="mock-time"><span>1:42</span><span>3:28</span></div>
          </div>
        </div>
        <div className="floating-pill pill-one">🔥 <span>this part!</span></div>
        <div className="floating-pill pill-two"><ListMusic size={17} /> <span>12 in queue</span></div>
      </div>
    </section>

    <section className="start-section" id="start">
      <div className="benefits">
        <div><span><Link2 /></span><h3>Drop a link</h3><p>Paste a YouTube link and it’s ready for the room.</p></div>
        <div><span><Headphones /></span><h3>Watch together</h3><p>Turn on Watch Party for synchronized video, timestamped chat, and spoiler-safe conversation.</p></div>
        <div><span><ListMusic /></span><h3>Build the queue</h3><p>Everyone gets a say in what plays next.</p></div>
      </div>

      <form className="room-card" onSubmit={enter}>
        <div className="mode-switch"><button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>Create a room</button><button type="button" className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>Join with code</button></div>
        <label>Your display name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} /></label>
        {mode === "create" ? <>
          <label>Room name<input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={48} placeholder="Late night listening" /></label>
          <label>Room capacity
            <select value={maxParticipants} onChange={(event) => setMaxParticipants(Number(event.target.value))}>
              {[10, 20, 30, 50, 75, 100].map((value) => <option key={value} value={value}>{value} listeners</option>)}
            </select>
            <small className="field-help">You can change this later in Host Controls. Connectify supports up to 100 listeners per room.</small>
          </label>
        </> : <label>Room code<input className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))} minLength={6} maxLength={6} placeholder="ABC123" /></label>}
        {error && <p className="form-error">{error}</p>}
        <button className="primary wide" disabled={busy}>{waking ? "Waking Connectify…" : busy ? "Tuning in…" : mode === "create" ? "Create listening room" : "Join the room"}<ArrowRight size={18} /></button>
        {recentRooms.length > 0 && <div className="recent-rooms">
          <span>Return to a room <small>{recentRooms.length > 3 ? `3 of ${recentRooms.length}` : recentRooms.length}</small></span>
          <div className="recent-room-list">{recentRooms.map((room) => <a key={room.code} href={`/room/${room.code}`}>
            <i><Radio /></i>
            <div className="recent-room-copy">
              <div><strong>{room.name}</strong><code>{room.code}</code></div>
              <p><span>{room.createdAt ? `Created ${formatRoomDate(room.createdAt)}` : "Creation date syncs on your next visit"}</span><span>{formatLastVisited(room.lastVisited)}</span></p>
            </div>
            <ArrowRight />
          </a>)}</div>
        </div>}
      </form>
    </section>
    <footer><Brand compact /><nav aria-label="Connectify information"><a href="/features">Features</a><a href="/how-it-works">How it works</a><a href="/faq">FAQ</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav><span>Made for music and good company.</span></footer>
  </main>;
}
