import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { ConnectifyMark } from "./Brand";
import { markWhatsNewSeen } from "./whats-new";
import "./whats-new.css";

type Phase = "reading" | "launching" | "closing";

const SECTIONS: Array<{ eyebrow: string; heading: string; items: Array<{ body: string; fixed?: boolean }> }> = [
  {
    eyebrow: "Chat",
    heading: "Actually readable now",
    items: [
      { body: "The message box was rendering at a tiny, squint-at-your-phone size. That was a one-character typo in our stylesheet, and it is fixed.", fixed: true },
      { body: "Enter sends your message. Shift+Enter starts a new line, the way you would expect." },
      { body: "Messages show the time you sent them, kept separate from the \"jump to this moment in the song\" timestamp so the two never get confused." },
      { body: "A shaky connection or an impatient double tap can no longer post the same message twice." },
      { body: "Every message shows where it is up to: sending, sent, or failed with a one-tap retry." },
    ],
  },
  {
    eyebrow: "Adding songs and playback",
    heading: "Less waiting around",
    items: [
      { body: "Songs land in the queue the moment you add them. No spinner, no waiting on us." },
      { body: "The first song in an empty room starts loading right away instead of after the server catches up." },
      { body: "Search stays open after you add something, so queuing up five songs in a row does not mean reopening it five times." },
      { body: "Track changes are smoother, especially when Connectify is in a background tab. We load the next song early and give playback a moment to settle instead of jumping in to correct it too eagerly." },
      { body: "A song that cannot play, because it is blocked, deleted, or unavailable where you are, now gets skipped automatically instead of quietly stalling the room.", fixed: true },
    ],
  },
  {
    eyebrow: "Smart Autoplay",
    heading: "Keeps the room going on its own",
    items: [
      { body: "Autoplay is on by default in every room now, and it leans toward finding you something new rather than replaying what you just heard." },
      { body: "There is a Familiar to Fresh slider in Host Controls. Slide it down to stick with what the room loves, or up to let it wander." },
      { body: "Paste a YouTube playlist link and Connectify pulls in up to 50 songs at once." },
      { body: "Autoplay picks tell you why they showed up, like \"Because this room played JVKE.\"" },
      { body: "Heard enough of a song forever? Mark it \"never play this again\" and autoplay will leave it alone." },
      { body: "Autoplay and sharing your room's songs to the Library are two separate switches now, so you can have either one without the other." },
    ],
  },
  {
    eyebrow: "The Connectify Library",
    heading: "Grows on its own now",
    items: [
      { body: "The shared catalog every room can search now fills itself in quietly in the background, finding music across genres without anyone adding it by hand." },
      { body: "It leans toward genres the catalog is thin on instead of piling more onto whatever is already well covered." },
      { body: "The same song uploaded three times as an \"official video,\" a \"lyrics video,\" and an \"audio only\" version used to show up as three separate results. Connectify recognises them as one song now.", fixed: true },
    ],
  },
  {
    eyebrow: "Search and queue",
    heading: "Small things, every single day",
    items: [
      { body: "Your recent searches and recently added songs are remembered, so re-adding a favourite takes one tap." },
      { body: "Search results now show you what is already sitting in the queue." },
      { body: "Connectify remembers whether you had Queue or Chat open, per device." },
      { body: "There are keyboard shortcuts now. Press ? in any room to see them. Space plays and pauses, N skips, and a few more." },
      { body: "The drag and select buttons in the queue looked like grey placeholder boxes. They match the rest of the app now.", fixed: true },
    ],
  },
  {
    eyebrow: "When you lose signal",
    heading: "The room does not just vanish",
    items: [
      { body: "If your connection drops, you can still browse the room: the queue, the chat, and who is listening." },
      { body: "Playback still needs a live connection. That is on purpose, it is what keeps everyone hearing the same thing at the same time." },
      { body: "On a slow or metered connection, Connectify stops loading extra thumbnails and pre-buffering in the background." },
    ],
  },
  {
    eyebrow: "Behind the scenes",
    heading: "Quicker to open",
    items: [
      { body: "Connectify used to nod off between visits, so whoever opened it first after a quiet spell waited about a minute for it to wake up. It stays awake now.", fixed: true },
      { body: "General reliability work across chat, search, and the queue." },
    ],
  },
];

export function WhatsNew({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("reading");
  const [atEnd, setAtEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  // Hold focus inside the overlay. There is deliberately no Escape handler and no
  // backdrop click: the only way out is reading to the bottom and pressing the button.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
      if (!items.length) { event.preventDefault(); panelRef.current?.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const checkEnd = () => {
    const list = scrollRef.current;
    if (!list) return;
    // A short viewport with no room to scroll should not trap anyone.
    if (list.scrollHeight - list.clientHeight <= 8 || list.scrollTop + list.clientHeight >= list.scrollHeight - 28) setAtEnd(true);
  };
  useEffect(checkEnd, []);

  const finish = () => {
    if (phase !== "reading" || !atEnd) return;
    markWhatsNewSeen();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { onDone(); return; }
    setPhase("launching");
    // Collapse into the loading mark, hold on it briefly, then fade the whole thing out.
    window.setTimeout(() => setPhase("closing"), 1_050);
    window.setTimeout(onDone, 1_600);
  };

  return (
    <div className={`whats-new whats-new-${phase}`} role="presentation">
      <section
        ref={panelRef}
        className="whats-new-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        tabIndex={-1}
      >
        <div className="whats-new-content">
          <header className="whats-new-head">
            <ConnectifyMark />
            <div>
              <p className="whats-new-date">Update · 6 August 2026</p>
              <h2 id="whats-new-title">A few things changed while you were away</h2>
            </div>
          </header>

          <div className="whats-new-scroll" ref={scrollRef} onScroll={checkEnd} tabIndex={0}>
            <p className="whats-new-lead">
              We spent the day on the parts of Connectify that were quietly annoying: chat you had to squint at,
              songs that took a beat too long to show up, and rooms that went silent once the queue ran dry.
              Here is everything that is different.
            </p>

            {SECTIONS.map((section) => (
              <section key={section.eyebrow} className="whats-new-entry">
                <p className="whats-new-eyebrow">{section.eyebrow}</p>
                <h3>{section.heading}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.body} className={item.fixed ? "is-fix" : ""}>
                      {item.fixed && <span className="whats-new-fix-tag">Fixed</span>}
                      {item.body}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <p className="whats-new-signoff">
              That is the lot. If something feels off, tell us. Connectify gets better because people actually use it.
            </p>
          </div>

          <footer className="whats-new-foot">
            <span aria-hidden="true" className={atEnd ? "is-done" : ""}>
              {atEnd ? "Thanks for reading" : "Scroll to the end to continue"}
            </span>
            <button
              type="button"
              className={`whats-new-go ${phase === "launching" || phase === "closing" ? "is-lit" : ""}`}
              onClick={finish}
              disabled={!atEnd || phase !== "reading"}
            >
              Let's go
            </button>
          </footer>
        </div>

        <div className="whats-new-morph" aria-hidden="true">
          <div className="connection-visual">
            <i className="signal-ring" /><i className="signal-ring" /><i className="signal-ring" />
            <i className="signal-disc" />
            <i className="signal-orbit"><b /></i>
            <i className="signal-orbit orbit-two"><b /></i>
            <span className="signal-core"><Radio /></span>
          </div>
        </div>
      </section>
    </div>
  );
}
