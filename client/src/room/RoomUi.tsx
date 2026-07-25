import { Fragment, useEffect, useState } from "react";
import { Reply, Plus, ListPlus } from "lucide-react";
import { effectivePosition } from "../playback";
import type { ChatMessage, Room, SearchItem, Track } from "../types";

export const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

export function PlaybackProgress({ room, current, onSeek }: { room: Room; current: Track | null; onSeek: (position: number) => void }) {
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

function highlightedMessage(body: string, names: string[]) {
  if (!names.length) return body;
  const escaped = [...names].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(`(@(?:${escaped.join("|")}))`, "gi");
  const normalizedNames = new Set(names.map((name) => `@${name}`.toLowerCase()));
  return body.split(matcher).map((part, index) => normalizedNames.has(part.toLowerCase())
    ? <mark key={`${part}-${index}`}>{part}</mark>
    : part);
}

export function ChatMessageRow({ message, previous, firstUnreadId, canControl, trackExists, mentionNames, revealed, onReveal, onJump, onReply }: {
  message: ChatMessage;
  previous?: ChatMessage;
  firstUnreadId: string | null;
  canControl: boolean;
  trackExists: boolean;
  mentionNames: string[];
  revealed: boolean;
  onReveal: () => void;
  onJump: () => void;
  onReply: () => void;
}) {
  const messageDate = new Date(message.createdAt);
  const showDate = !previous || new Date(previous.createdAt).toDateString() !== messageDate.toDateString();
  const hidden = message.spoiler && !revealed;
  return <Fragment>
    {showDate && <div className="chat-date"><span>{messageDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: messageDate.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined })}</span></div>}
    {firstUnreadId === message.id && <div className="new-message-divider"><span>New messages</span></div>}
    <article data-message-id={message.id}>
      <i>{message.avatar}</i>
      <div>
        <header><strong>{message.name}</strong>{message.position !== null && <button disabled={!canControl || !trackExists} onClick={onJump}>{formatTime(message.position)}</button>}<button className="reply-message" onClick={onReply} aria-label={`Reply to ${message.name}`}><Reply /></button></header>
        {message.replyTo && <div className="chat-reply-context"><strong>{message.replyTo.name}</strong><span>{message.replyTo.spoiler ? "Spoiler-hidden message" : message.replyTo.body}</span></div>}
        {hidden ? <button className="spoiler-message" onClick={onReveal}>Spoiler hidden · reveal</button> : <p>{highlightedMessage(message.body, mentionNames)}</p>}
      </div>
    </article>
  </Fragment>;
}

export function SearchResult({ item, canControl, adding, onAdd }: { item: SearchItem; canControl: boolean; adding: boolean; onAdd: (url: string, placement?: "last" | "next", metadata?: SearchItem) => Promise<void> }) {
  return <article className="search-result">
    <img src={item.thumbnail || "/connectify.svg"} alt="" loading="lazy" />
    <div><strong>{item.title}</strong><span>{item.artist}</span><small>{item.source === "connectify" ? "Connectify Library" : "YouTube"}</small></div>
    <div className="search-result-actions"><button disabled={adding} onClick={() => void onAdd(item.url, "last", item)} title="Add through the normal fair queue"><Plus />Add to queue</button>{canControl && <button disabled={adding} onClick={() => void onAdd(item.url, "next", item)} title="Play immediately after the current video"><ListPlus />Play next</button>}</div>
  </article>;
}
