import { ArrowRight, Check, Headphones, Link2, ListMusic, Radio, Search, ShieldCheck, Sparkles, Users, Youtube } from "lucide-react";

type PageContent = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: Array<{ title: string; body: string; points?: string[] }>;
};

export const publicPaths = ["/listen-together", "/watch-party", "/features", "/how-it-works", "/faq", "/privacy", "/terms"];

const pages: Record<string, PageContent> = {
  "/listen-together": {
    eyebrow: "SYNCHRONIZED LISTENING",
    title: "Listen to YouTube together, wherever everyone is",
    intro: "Connectify gives friends one shared player and a collaborative music queue. Create a room without an account, invite people with a link, and stay on the same moment.",
    sections: [
      { title: "One room, one timeline", body: "Play, pause, seek, and skip changes are synchronized across the room, while Connectify corrects playback drift in the background." },
      { title: "A queue everyone can shape", body: "Search YouTube or paste a URL, add a track, and vote once for the songs you want to hear.", points: ["Fair contributor rotation", "Duplicate protection", "Play Next controls", "Persistent listening history"] },
      { title: "Free and accountless", body: "Guests receive a private identity stored only in their browser. There is no sign-up wall between an invitation and the music." },
    ],
  },
  "/watch-party": {
    eyebrow: "REMOTE WATCH PARTIES",
    title: "Watch YouTube together from afar",
    intro: "Turn a Connectify room into a synchronized YouTube watch party with a theater layout, shared controls, timestamped chat, and spoiler-safe messages.",
    sections: [
      { title: "Stay on the same scene", body: "The room shares an authoritative playback timeline and automatically catches returning viewers up to the current moment." },
      { title: "Talk about exact moments", body: "Chat messages can remain attached to a video timestamp, making reactions and callbacks easy to revisit." },
      { title: "Spoilers stay hidden", body: "Mark messages as spoilers so everyone chooses when to reveal them." },
    ],
  },
  "/features": {
    eyebrow: "BUILT FOR THE WHOLE ROOM",
    title: "Shared queues without the usual friction",
    intro: "Connectify combines synchronized YouTube playback with the collaborative controls expected from a modern music room.",
    sections: [
      { title: "Find and add", body: "Search YouTube inside the room, reuse fast cached results, or paste a YouTube URL as the always-available fallback.", points: ["Paginated YouTube search", "Connectify discovery library", "Metadata caching", "Queue duplicate checks"] },
      { title: "Listen fairly", body: "Fair Queue rotates contributors while votes decide which of each person’s choices comes first.", points: ["One vote per person and song", "Per-guest queue limits", "DJ Autopilot", "Listening history"] },
      { title: "Make the room yours", body: "Choose party modes, room themes, guest permissions, moments, reactions, and Watch Party chat." },
    ],
  },
  "/how-it-works": {
    eyebrow: "THREE QUICK STEPS",
    title: "From invitation to synchronized playback",
    intro: "Connectify is designed so a group can start listening before anyone has to create an account.",
    sections: [
      { title: "1. Create or join", body: "Name a room or enter its six-character invitation code. Connectify remembers recent rooms on that browser." },
      { title: "2. Search or paste", body: "Find a video with built-in YouTube search, or paste its URL directly into the room composer." },
      { title: "3. Press play together", body: "Room controls update the shared timeline. Reconnecting listeners catch up automatically." },
    ],
  },
  "/faq": {
    eyebrow: "FREQUENTLY ASKED QUESTIONS",
    title: "Questions about listening together",
    intro: "The essentials about Connectify rooms, playback, privacy, and supported videos.",
    sections: [
      { title: "Do I need an account?", body: "No. Connectify creates a private browser identity so you can join and contribute immediately." },
      { title: "Which links work?", body: "Connectify currently supports standard YouTube, YouTube Music, mobile YouTube, Shorts, embed, and youtu.be video URLs. A video must still allow embedded playback in the viewer’s country." },
      { title: "Is Connectify free?", body: "Yes. Creating and joining rooms is free." },
      { title: "Why can a room take longer to open sometimes?", body: "The free backend may pause after inactivity. Opening Connectify immediately starts waking it, and the room continues automatically when it is ready." },
      { title: "Does background audio always work?", body: "Desktop browsers generally keep an existing player active. Mobile operating systems may suspend browser tabs or block a newly loaded embedded video until the page is foregrounded." },
    ],
  },
  "/privacy": {
    eyebrow: "PRIVACY",
    title: "Connectify privacy notice",
    intro: "Connectify is accountless by default and collects only the information needed to operate shared rooms.",
    sections: [
      { title: "Information stored", body: "A random browser identifier, display name, avatar, room membership, queue activity, votes, reactions, and watch-party messages may be stored so rooms remain functional and persistent." },
      { title: "Browser storage", body: "Your browser stores your Connectify identity, recent rooms, and private host tokens. Clearing site data removes that browser’s local copy." },
      { title: "Service providers", body: "The frontend is delivered through Vercel, the realtime API through Render, persistent data through Neon, and YouTube videos and search through Google services. Their systems may process technical data such as IP addresses under their own policies." },
      { title: "Public discovery", body: "Private room names, member lists, and room codes are not included in public search pages. When a host enables discovery, video metadata from that room may appear in Connectify Library results." },
      { title: "Contact and deletion", body: "Privacy questions and deletion requests can be submitted through the Connectify project’s public GitHub issue tracker." },
    ],
  },
  "/terms": {
    eyebrow: "TERMS",
    title: "Connectify terms of use",
    intro: "Use Connectify respectfully and only with content you are permitted to access.",
    sections: [
      { title: "Room conduct", body: "Do not use rooms to harass others, distribute unlawful material, disrupt the service, or attempt to bypass room permissions." },
      { title: "Third-party media", body: "YouTube supplies embedded playback and search results. Availability, advertising, geographic restrictions, and playback permissions remain controlled by YouTube and the video owner." },
      { title: "No availability guarantee", body: "Connectify is currently free software under active development. Rooms may be interrupted by hosting, network, browser, or third-party service limitations." },
      { title: "Changes", body: "Features and these terms may change as Connectify develops. Material changes will be reflected on this page." },
    ],
  },
  "/not-found": {
    eyebrow: "404",
    title: "That page is not in the queue",
    intro: "The address may be incomplete or the page may have moved.",
    sections: [],
  },
};

export function PublicPage({ path }: { path: string }) {
  const page = pages[path] || pages["/not-found"];
  const icons = [<Headphones />, <ListMusic />, <Users />, <Search />, <Youtube />, <ShieldCheck />, <Link2 />, <Sparkles />];
  return <main className="public-page">
    <nav className="landing-nav">
      <a className="brand" href="/"><span className="brand-mark"><Radio size={19} /></span> connectify</a>
      <div className="public-nav-links"><a href="/listen-together">Listen together</a><a href="/watch-party">Watch party</a><a href="/features">Features</a><a href="/faq">FAQ</a></div>
      <a className="secondary" href="/#start">Create a room</a>
    </nav>
    <header className="public-hero"><span>{page.eyebrow}</span><h1>{page.title}</h1><p>{page.intro}</p>{path !== "/not-found" && <a className="primary" href="/#start">Start for free <ArrowRight /></a>}</header>
    <section className="public-content">
      {page.sections.map((section, index) => <article key={section.title}>
        <div className="public-section-icon">{icons[index % icons.length]}</div>
        <div><h2>{section.title}</h2><p>{section.body}</p>{section.points && <ul>{section.points.map((point) => <li key={point}><Check />{point}</li>)}</ul>}</div>
      </article>)}
    </section>
    <footer><a className="brand" href="/"><span className="brand-mark"><Radio size={16} /></span> connectify</a><nav><a href="/how-it-works">How it works</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav><span>Free shared listening rooms.</span></footer>
  </main>;
}
