import { useState } from "react";
import { ArrowRight, Headphones, Link2, ListMusic, Radio, Sparkles } from "lucide-react";
import { api } from "./api";
import { getIdentity, getRecentRooms, saveHostToken, saveIdentity } from "./identity";

export function Landing() {
  const identity = getIdentity();
  const recentRooms = getRecentRooms();
  const [name, setName] = useState(identity.name);
  const [roomName, setRoomName] = useState("Friday night mix");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enter = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setBusy(true);
    const nextIdentity = { ...identity, name: name.trim() || identity.name };
    saveIdentity(nextIdentity);
    try {
      if (mode === "create") {
        const room = await api<{ code: string; hostToken: string }>("/api/rooms", { method: "POST", body: JSON.stringify({ name: roomName, userId: identity.userId }) });
        saveHostToken(room.code, room.hostToken);
        window.location.href = `/room/${room.code}`;
      } else {
        await api(`/api/rooms/${code.toUpperCase()}`);
        window.location.href = `/room/${code.toUpperCase()}`;
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not enter the room."); setBusy(false); }
  };

  return <main className="landing">
    <nav className="landing-nav">
      <a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a>
      <button className="text-button" onClick={() => { setMode("join"); document.querySelector(".room-card")?.scrollIntoView({ behavior: "smooth" }); }}>Join a room</button>
    </nav>

    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={14} /> Music and watch parties, in sync</div>
        <h1>Good songs are<br /><em>better together.</em></h1>
        <p>Create a room, drop a YouTube link, and press play. Hear the same song or watch the same video together—wherever everyone is.</p>
        <button className="primary hero-action" onClick={() => document.querySelector(".room-card")?.scrollIntoView({ behavior: "smooth" })}>Start listening <ArrowRight size={18} /></button>
        <div className="trust-row"><span><span className="live-dot" /> No account needed</span><span>Free to start</span></div>
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

    <section className="start-section">
      <div className="benefits">
        <div><span><Link2 /></span><h3>Drop a link</h3><p>Paste a YouTube link and it’s ready for the room.</p></div>
        <div><span><Headphones /></span><h3>Watch together</h3><p>Turn on Watch Party for synchronized video, timestamped chat, and spoiler-safe conversation.</p></div>
        <div><span><ListMusic /></span><h3>Build the queue</h3><p>Everyone gets a say in what plays next.</p></div>
      </div>

      <form className="room-card" onSubmit={enter}>
        <div className="mode-switch"><button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>Create a room</button><button type="button" className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>Join with code</button></div>
        <label>Your display name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} /></label>
        {mode === "create" ? <label>Room name<input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={48} placeholder="Late night listening" /></label> : <label>Room code<input className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))} minLength={6} maxLength={6} placeholder="ABC123" /></label>}
        {error && <p className="form-error">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? "Tuning in…" : mode === "create" ? "Create listening room" : "Join the room"}<ArrowRight size={18} /></button>
        {recentRooms.length > 0 && <div className="recent-rooms"><span>Return to a room</span>{recentRooms.slice(0, 3).map((room) => <a key={room.code} href={`/room/${room.code}`}><i><Radio /></i><strong>{room.name}</strong><small>{room.code}</small><ArrowRight /></a>)}</div>}
      </form>
    </section>
    <footer><a className="brand" href="/"><span className="brand-mark"><Radio size={16} /></span> connectify</a><span>Made for music and good company.</span></footer>
  </main>;
}
