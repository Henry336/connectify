import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { ConnectifyMark } from "./Brand";
import { RELEASES } from "./changelog-data";
import { markWhatsNewSeen } from "./whats-new";
import "./whats-new.css";

type Phase = "reading" | "launching" | "closing";

// Always the newest release. Older ones are for the on-demand reader (ChangelogHistory),
// not this first-run overlay -- someone opening Connectify for the first time in a while
// only needs to know what changed most recently, not the last three releases at once.
const latest = RELEASES[0];

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
              <p className="whats-new-date">Update · {latest.dateLabel}</p>
              <h2 id="whats-new-title">A few things changed while you were away</h2>
            </div>
          </header>

          <div className="whats-new-scroll" ref={scrollRef} onScroll={checkEnd} tabIndex={0}>
            <p className="whats-new-lead">{latest.lead}</p>

            {latest.sections.map((section) => (
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
