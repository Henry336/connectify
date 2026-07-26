import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowLeft, ArrowUp, Bell, BellOff, Check, CheckSquare, ChevronRight, Copy, Dna, EyeOff, Gamepad2, GripVertical, Heart, History, Info, KeyRound, Library, Link2, ListMusic, ListPlus, Lock, LogOut, Maximize2, MessageCircle, MoreHorizontal, Palette, Pause, Play, Plus, Radio, Reply, RotateCw, Search, Send, Share2, ShieldCheck, SkipBack, SkipForward, Sparkles, Square, Trash2, Undo2, UserMinus, UserRoundCheck, Users, Volume2, VolumeX, WandSparkles, Wifi, WifiOff, X, Youtube } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { api, API_URL, recordClientTiming, waitForBackend } from "./api";
import { getHostToken, getIdentity, rememberRoom, removeHostToken, saveHostToken, saveIdentity } from "./identity";
import { effectivePosition, withReceipt } from "./playback";
import type { ChatMessage, Moment, PartyMode, Person, Room, RoomActivity, RoomMember, RoomTheme, SearchItem, Track } from "./types";
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer";
import { ChatMessageRow, formatTime, PlaybackProgress, SearchResult } from "./room/RoomUi";
import { useRoomDna } from "./room/useRoomDna";
import { Brand } from "./Brand";
import "./room/room-enhancements.css";

const LazyFeatureModal = lazy(() => import("./room/FeatureModal"));
function FeatureModal(props: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; variant?: "default" | "wide" | "showcase" }) {
  const variant = props.variant ?? (props.title === "Room DNA" ? "showcase" : props.title === "Host Controls" || props.title === "Listener moderation" ? "wide" : "default");
  return <Suspense fallback={null}><LazyFeatureModal {...props} variant={variant} /></Suspense>;
}
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
const activityText = (event: Pick<RoomActivity, "actorName" | "action" | "target">) => {
  const target = event.target ? ` ${event.target}` : "";
  const targetMode = event.target ? modeName(event.target as PartyMode) : "";
  const labels: Record<string, string> = {
    changed_mode: `changed the party mode to ${targetMode}`,
    changed_capacity: `set room capacity to${target}`,
    changed_slow_mode: event.target === "0" ? "turned chat slow mode off" : `set chat slow mode to${target}s`,
    skipped_track: "skipped the track",
    cleared_queue: "cleared the queue",
    removed_member: `removed${target}`,
    blocked_member: `blocked${target}`,
    unblocked_member: `unblocked${target}`,
    handed_off_host: `handed host access to${target}`,
    bulk_remove: `removed${target}`,
    bulk_top: `moved${target} to the top`,
    bulk_bottom: `moved${target} to the bottom`,
  };
  return `${event.actorName} ${labels[event.action] || event.action.replaceAll("_", " ")}`;
};
const clockEta = (seconds: number) => new Date(Date.now() + seconds * 1_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const newOperationId = () => crypto.randomUUID();
function emitReliable<T extends { ok: boolean; error?: string }>(socket: Socket, event: string, payload: Record<string, unknown>, onResult: (result: T) => void) {
  let attempt = 0;
  let settled = false;
  const send = () => {
    attempt += 1;
    socket.timeout(8_000).emit(event, payload, (timeoutError: Error | null, result: T) => {
      if (settled) return;
      if (!timeoutError && result) {
        settled = true;
        onResult(result);
        return;
      }
      if (attempt < 2) send();
      else {
        settled = true;
        onResult({ ok: false, error: "The connection timed out. Connectify is resyncing." } as T);
      }
    });
  };
  send();
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
  const [joinErrorCode, setJoinErrorCode] = useState<string | null>(null);
  const [joinNotice, setJoinNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [votedTrackIds, setVotedTrackIds] = useState<Set<string>>(() => new Set());
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("connectify.volume"));
    return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 72;
  });
  const [roomMenu, setRoomMenu] = useState(false);
  const [queueMenu, setQueueMenu] = useState(false);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [fairInfoOpen, setFairInfoOpen] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activities, setActivities] = useState<RoomActivity[]>([]);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [eventToasts, setEventToasts] = useState<Array<{ id: string; text: string }>>([]);
  const [profileName, setProfileName] = useState(identity.name);
  const [profileAvatar, setProfileAvatar] = useState(identity.avatar);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const [tutorialVisible, setTutorialVisible] = useState(() => localStorage.getItem("connectify.roomTutorialDismissed") !== "true");
  const [role, setRole] = useState<"host" | "guest">("guest");
  const [momentBursts, setMomentBursts] = useState<Moment[]>([]);
  const [placement, setPlacement] = useState<"last" | "next">("last");
  const [sideTab, setSideTab] = useState<"queue" | "chat">("queue");
  const [chatBody, setChatBody] = useState(() => {
    try { return sessionStorage.getItem(`connectify.chatDraft.${code}`) || ""; }
    catch { return ""; }
  });
  const [chatSpoiler, setChatSpoiler] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [unreadChat, setUnreadChat] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [chatAtBottom, setChatAtBottom] = useState(true);
  const [loadingOlderChat, setLoadingOlderChat] = useState(false);
  const [hasMoreChat, setHasMoreChat] = useState(false);
  const [chatSound, setChatSound] = useState(() => localStorage.getItem("connectify.chatSound") === "true");
  const [chatNotifications, setChatNotifications] = useState(() => localStorage.getItem("connectify.chatNotifications") === "true");
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(() => new Set());
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [wakingRoom, setWakingRoom] = useState(false);
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
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersHasMore, setMembersHasMore] = useState(false);
  const [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [blockedMembers, setBlockedMembers] = useState<RoomMember[]>([]);
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const seekTimerRef = useRef<number | null>(null);
  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const sideTabRef = useRef(sideTab);
  const chatAtBottomRef = useRef(chatAtBottom);
  const roomRef = useRef(room);
  const chatSoundRef = useRef(chatSound);
  const chatNotificationsRef = useRef(chatNotifications);
  sideTabRef.current = sideTab;
  chatAtBottomRef.current = chatAtBottom;
  roomRef.current = room;
  chatSoundRef.current = chatSound;
  chatNotificationsRef.current = chatNotifications;

  useEffect(() => {
    document.title = room ? `${room.name} — Connectify` : `Joining room ${code} — Connectify`;
  }, [code, room?.name]);

  useEffect(() => {
    try { sessionStorage.setItem(`connectify.chatDraft.${code}`, chatBody); }
    catch { /* Draft persistence is optional in hardened browser modes. */ }
  }, [chatBody, code]);

  useEffect(() => {
    localStorage.setItem("connectify.chatSound", String(chatSound));
    localStorage.setItem("connectify.chatNotifications", String(chatNotifications));
  }, [chatSound, chatNotifications]);

  useEffect(() => {
    localStorage.setItem("connectify.volume", String(volume));
  }, [volume]);

  useEffect(() => () => {
    if (seekTimerRef.current !== null) window.clearTimeout(seekTimerRef.current);
  }, []);

  useEffect(() => {
    let active = true;
    const wakingTimer = window.setTimeout(() => setWakingRoom(true), 500);
    let connection: Socket | null = null;
    let joinRetryTimer: number | null = null;
    let recoveryInFlight = false;
    const recoverRevisionGap = () => {
      if (!connection || recoveryInFlight) return;
      recoveryInFlight = true;
      const startedAt = performance.now();
      connection.emit("room:sync", {}, (result: { ok: boolean; snapshot?: Room }) => {
        recoveryInFlight = false;
        recordClientTiming("socket:room:revision-recovery", performance.now() - startedAt);
        if (result?.ok && result.snapshot) {
          const received = withReceipt(result.snapshot);
          setRoom(received);
          setHasMoreChat(received.hasMoreMessages);
        }
      });
    };
    const mergeIncremental = (patch: Partial<Room> & { revision: number; serverTime?: string }) => {
      setRoom((previous) => {
        if (!previous || patch.revision <= previous.revision) return previous;
        if (patch.revision > previous.revision + 1) {
          window.queueMicrotask(recoverRevisionGap);
          return previous;
        }
        return withReceipt({ ...previous, ...patch, serverTime: patch.serverTime || new Date().toISOString() });
      });
    };
    void waitForBackend().then(() => {
      if (!active) return;
      connection = io(API_URL, { transports: ["websocket", "polling"], reconnectionDelay: 250, reconnectionDelayMax: 2_000 });
      connection.on("connect", () => {
        setConnectionState("connected");
        const join = (attempt = 0) => {
          const startedAt = performance.now();
          connection!.emit("room:join", { code, ...identity, hostToken: getHostToken(code) }, (result: { ok: boolean; role?: "host" | "guest"; hostToken?: string; code?: string; retryable?: boolean; error?: string; snapshot?: Room; votes?: string[] }) => {
            recordClientTiming("socket:room:join", performance.now() - startedAt);
            if (!result?.ok || !result.snapshot) {
              if (result?.retryable && attempt < 20 && connection?.connected) {
                setWakingRoom(true);
                setJoinNotice(result.error || "Connectify is finishing an update. Retrying automatically…");
                joinRetryTimer = window.setTimeout(() => join(attempt + 1), Math.min(8_000, 1_500 + attempt * 500));
                return;
              }
              setRoom(null);
              setJoinNotice("");
              setJoinErrorCode(result?.code || "JOIN_FAILED");
              setError(result?.error || "Could not join this room. Please retry.");
              connection?.disconnect();
              return;
            }
            const received = withReceipt(result.snapshot);
            window.clearTimeout(wakingTimer);
            if (joinRetryTimer !== null) window.clearTimeout(joinRetryTimer);
            setWakingRoom(false);
            setJoinNotice("");
            setJoinErrorCode(null);
            setError("");
            rememberRoom(received.code, received.name);
            setRoom(received);
            setHasMoreChat(received.hasMoreMessages);
            setVotedTrackIds(new Set(result.votes || []));
            setRole(result.role || "guest");
            if (result.hostToken) saveHostToken(code, result.hostToken);
          });
        };
        join();
      });
      connection.on("disconnect", () => setConnectionState("reconnecting"));
      connection.io.on("reconnect_attempt", () => setConnectionState("reconnecting"));
      connection.on("room:snapshot", (snapshot: Room) => {
        const received = withReceipt(snapshot);
        setRoom((previous) => !previous || snapshot.revision >= previous.revision ? received : previous);
        setHasMoreChat(received.hasMoreMessages);
      });
      connection.on("room:queue", (state: Partial<Room> & { revision: number }) => state && mergeIncremental(state));
      connection.on("room:playback", (state: Partial<Room> & { revision: number }) => state && mergeIncremental(state));
      connection.on("room:settings-patch", (state: Partial<Room> & { revision: number }) => state && mergeIncremental(state));
      connection.on("track:duration-updated", ({ trackId, duration }: { trackId: string; duration: number }) => setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.map((track) => track.id === trackId ? { ...track, duration } : track) } : previous));
      connection.on("room:presence", setPeople);
      connection.on("queue:votes", (ids: string[]) => setVotedTrackIds(new Set(ids)));
      connection.on("queue:vote-updated", ({ trackId, votes }: { trackId: string; votes: number }) => setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.map((track) => track.id === trackId ? { ...track, votes } : track) } : previous));
      connection.on("room:moment", (moment: Moment) => {
        setRoom((previous) => previous ? { ...previous, moments: [...previous.moments, moment].slice(-60) } : previous);
        setMomentBursts((previous) => [
          ...previous.filter((item) => !(item.id.startsWith("pending-") && item.userId === moment.userId && item.trackId === moment.trackId && item.emoji === moment.emoji)),
          moment,
        ].slice(-5));
        window.setTimeout(() => setMomentBursts((previous) => previous.filter((item) => item.id !== moment.id)), 2600);
      });
      connection.on("room:chat", (message: ChatMessage) => {
        setRoom((previous) => previous && !previous.messages.some((item) => item.id === message.id) ? { ...previous, messages: [...previous.messages, message] } : previous);
        if (message.userId === identity.userId) return;
        const activelyReading = sideTabRef.current === "chat" && !document.hidden && chatAtBottomRef.current;
        if (!activelyReading) {
          setUnreadChat((count) => count + 1);
          setFirstUnreadId((current) => current || message.id);
          const mentioned = message.body.toLowerCase().includes(`@${identity.name.toLowerCase()}`);
          if (chatNotificationsRef.current && document.hidden && "Notification" in window && Notification.permission === "granted") {
            const activeRoom = roomRef.current;
            new Notification(mentioned ? `${message.name} mentioned you` : `${message.name} in ${activeRoom?.name || "Connectify"}`, {
              body: message.spoiler ? "Sent a spoiler-hidden message" : message.body,
              icon: "/connectify.svg",
              tag: `connectify-${code}-${message.id}`,
            });
          }
          if (chatSoundRef.current) {
            try {
              const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
              const context = new AudioContextClass();
              const oscillator = context.createOscillator();
              const gain = context.createGain();
              oscillator.frequency.value = mentioned ? 660 : 520;
              gain.gain.setValueAtTime(0.04, context.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
              oscillator.connect(gain); gain.connect(context.destination);
              oscillator.start(); oscillator.stop(context.currentTime + 0.12);
              oscillator.addEventListener("ended", () => void context.close());
            } catch { /* Sound alerts are best-effort. */ }
          }
        } else {
          window.setTimeout(() => {
            const list = chatListRef.current;
            if (list) list.scrollTop = list.scrollHeight;
          }, 0);
        }
      });
      connection.on("queue:removed", (removed: { trackId: string; title: string }) => { setRemovedTrack(removed); window.setTimeout(() => setRemovedTrack((current) => current?.trackId === removed.trackId ? null : current), 8000); });
      connection.on("room:removed", () => { window.alert("The host removed you from this room. You can rejoin with the room link."); window.location.href = "/"; });
      connection.on("room:kicked", () => { window.alert("The host blocked this guest identity from the room."); window.location.href = "/"; });
      connection.on("room:host-role", ({ role: nextRole }: { role: "host" | "guest" }) => {
        setRole(nextRole);
        if (nextRole === "guest") removeHostToken(code);
      });
      connection.on("room:host-changed", ({ userId }: { userId: string }) => {
        setRoom((previous) => previous ? { ...previous, members: previous.members.map((member) => ({ ...member, role: member.userId === userId ? "host" : "guest" })) } : previous);
      });
      connection.on("room:activity", (event: RoomActivity) => {
        setActivities((previous) => previous.some((item) => item.id === event.id) ? previous : [event, ...previous].slice(0, 100));
      });
      connection.on("room:event", (event: RoomActivity) => {
        const toast = { id: event.id, text: activityText(event) };
        setEventToasts((previous) => [...previous, toast].slice(-3));
        window.setTimeout(() => setEventToasts((previous) => previous.filter((item) => item.id !== toast.id)), 4_500);
      });
      connection.on("room:host-transferred", ({ hostToken }: { hostToken: string }) => {
        saveHostToken(code, hostToken);
        setRole("host");
        setError("You are now the room host. Save the new recovery key from Host Controls.");
      });
      setSocket(connection);
    });
    return () => { active = false; window.clearTimeout(wakingTimer); if (joinRetryTimer !== null) window.clearTimeout(joinRetryTimer); connection?.disconnect(); };
  }, [code]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".menu-wrap")) { setRoomMenu(false); setQueueMenu(false); } };
    const closeMenusWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRoomMenu(false);
        setQueueMenu(false);
      }
    };
    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", closeMenusWithKeyboard);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", closeMenusWithKeyboard);
    };
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
  const playedTracks = historyTracks;
  const mentionNames = useMemo(() => [...new Set([...people.map((person) => person.name), ...(room?.members.map((member) => member.name) || [])])], [people, room?.members]);
  const mentionSuggestions = useMemo(() => {
    const match = chatBody.match(/(?:^|\s)@([^@\n]*)$/);
    if (!match) return [];
    const query = match[1].trim().toLowerCase();
    return mentionNames.filter((name) => name !== identity.name && name.toLowerCase().startsWith(query)).slice(0, 5);
  }, [chatBody, mentionNames, identity.name]);
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
  const roomDna = useRoomDna(room, people);

  const requestSync = useCallback(() => {
    socket?.emit("room:sync", {}, (result: { ok: boolean; snapshot?: Room }) => {
      if (result?.ok && result.snapshot) {
        const received = withReceipt(result.snapshot);
        setRoom(received);
        setHasMoreChat(received.hasMoreMessages);
      }
    });
  }, [socket]);
  const loadOlderMessages = useCallback(() => {
    if (!socket || !room?.messages.length || loadingOlderChat || !hasMoreChat) return;
    const list = chatListRef.current;
    const previousHeight = list?.scrollHeight || 0;
    setLoadingOlderChat(true);
    socket.emit("room:messages", { before: room.messages[0].createdAt }, (result: { ok: boolean; messages?: ChatMessage[]; hasMore?: boolean }) => {
      setLoadingOlderChat(false);
      if (!result?.ok || !result.messages) return;
      setHasMoreChat(Boolean(result.hasMore));
      setRoom((previous) => {
        if (!previous) return previous;
        const messages = [...result.messages!, ...previous.messages];
        return { ...previous, messages: [...new Map(messages.map((message) => [message.id, message])).values()] };
      });
      window.requestAnimationFrame(() => {
        const currentList = chatListRef.current;
        if (currentList) currentList.scrollTop += currentList.scrollHeight - previousHeight;
      });
    });
  }, [socket, room?.messages, loadingOlderChat, hasMoreChat]);
  const loadMembers = useCallback((reset = false) => {
    if (!socket || membersLoading || (!reset && !membersHasMore)) return;
    setMembersLoading(true);
    socket.emit("room:members", { cursor: reset ? undefined : memberCursor || undefined }, (result: { ok: boolean; members?: RoomMember[]; hasMore?: boolean; cursor?: string | null }) => {
      setMembersLoading(false);
      if (!result?.ok || !result.members) return;
      setMembersHasMore(Boolean(result.hasMore));
      setMemberCursor(result.cursor || null);
      setRoom((previous) => previous ? {
        ...previous,
        members: reset ? result.members! : [...new Map([...previous.members, ...result.members!].map((member) => [member.id, member])).values()],
      } : previous);
    });
  }, [socket, membersLoading, membersHasMore, memberCursor]);
  const loadBlockedMembers = useCallback(() => {
    if (!socket) return;
    socket.emit("room:blocked-members", {}, (result: { ok: boolean; members?: RoomMember[] }) => {
      if (result?.ok && result.members) setBlockedMembers(result.members);
    });
  }, [socket]);
  const loadHistory = useCallback((reset = false) => {
    if (!socket || historyLoading || (!reset && !historyHasMore)) return;
    setHistoryLoading(true);
    socket.emit("room:history", { before: reset ? undefined : historyCursor || undefined }, (result: { ok: boolean; tracks?: Track[]; hasMore?: boolean; cursor?: string | null }) => {
      setHistoryLoading(false);
      if (!result?.ok || !result.tracks) return;
      setHistoryHasMore(Boolean(result.hasMore));
      setHistoryCursor(result.cursor || null);
      setHistoryTracks((previous) => reset ? result.tracks! : [...new Map([...previous, ...result.tracks!].map((track) => [track.id, track])).values()]);
    });
  }, [socket, historyLoading, historyHasMore, historyCursor]);
  const loadActivity = useCallback((reset = false) => {
    if (!socket || activityLoading || (!reset && !activityHasMore)) return;
    setActivityLoading(true);
    socket.emit("room:activity-page", { before: reset ? undefined : activities.at(-1)?.createdAt }, (result: { ok: boolean; events?: RoomActivity[]; hasMore?: boolean }) => {
      setActivityLoading(false);
      if (!result?.ok || !result.events) return;
      setActivityHasMore(Boolean(result.hasMore));
      setActivities((previous) => reset ? result.events! : [...previous, ...result.events!]);
    });
  }, [socket, activityLoading, activityHasMore, activities]);
  const setPlayback = useCallback((track: Track | null, isPlaying: boolean, position = 0) => {
    if (!track || !canControl || !socket || track.pending) return;
    if (seekTimerRef.current !== null) {
      window.clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    const now = new Date().toISOString();
    setRoom((previous) => previous ? withReceipt({
      ...previous,
      currentTrackId: track.id,
      isPlaying,
      playbackPosition: position,
      startedAt: isPlaying ? now : null,
      serverTime: now,
    }) : previous);
    const startedAt = performance.now();
    socket.emit("playback:set", { trackId: track.id, isPlaying, position }, (result: { ok: boolean; error?: string }) => {
      recordClientTiming("socket:playback:set", performance.now() - startedAt);
      if (!result?.ok) { requestSync(); setError(result?.error || "Playback changed before that command arrived."); }
    });
  }, [socket, canControl, requestSync]);
  const seekPlayback = useCallback((track: Track | null, isPlaying: boolean, position: number) => {
    if (!track || !canControl || !socket || track.pending) return;
    const now = new Date().toISOString();
    setRoom((previous) => previous ? withReceipt({
      ...previous,
      currentTrackId: track.id,
      isPlaying,
      playbackPosition: position,
      startedAt: isPlaying ? now : null,
      serverTime: now,
    }) : previous);
    if (seekTimerRef.current !== null) window.clearTimeout(seekTimerRef.current);
    seekTimerRef.current = window.setTimeout(() => {
      seekTimerRef.current = null;
      const startedAt = performance.now();
      socket.emit("playback:set", { trackId: track.id, isPlaying, position }, (result: { ok: boolean; error?: string }) => {
        recordClientTiming("socket:playback:seek", performance.now() - startedAt);
        if (!result?.ok) { requestSync(); setError(result?.error || "Playback changed before that seek arrived."); }
      });
    }, 120);
  }, [socket, canControl, requestSync]);
  const skip = useCallback((direction: -1 | 1, reason: "manual" | "ended" = "manual") => {
    if (!current || !socket || (reason !== "ended" && !canControl)) return;
    if (reason === "manual") {
      const currentIndex = orderedTracks.findIndex((track) => track.id === current.id);
      const target = direction === 1 ? orderedTracks[currentIndex + 1] : playedTracks[0];
      const now = new Date().toISOString();
      setRoom((previous) => previous ? withReceipt({
        ...previous,
        currentTrackId: target?.id || previous.currentTrackId,
        isPlaying: Boolean(target),
        playbackPosition: 0,
        startedAt: target ? now : null,
        serverTime: now,
      }) : previous);
    }
    const startedAt = performance.now();
    emitReliable(socket, "playback:advance", { trackId: current.id, direction, reason, operationId: newOperationId() }, (result: { ok: boolean; error?: string }) => {
      recordClientTiming("socket:playback:advance", performance.now() - startedAt);
      if (!result?.ok && reason === "manual") { requestSync(); setError(result?.error || "The queue changed before that skip arrived."); }
    });
  }, [current, socket, canControl, orderedTracks, playedTracks, requestSync]);
  const vote = useCallback((trackId: string) => {
    if (!socket || votedTrackIds.has(trackId)) return;
    setVotedTrackIds((previous) => new Set(previous).add(trackId));
    setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.map((track) => track.id === trackId ? { ...track, votes: track.votes + 1 } : track) } : previous);
    emitReliable(socket, "queue:vote", { trackId, operationId: newOperationId() }, (result: { ok: boolean; error?: string; alreadyVoted?: boolean }) => {
      if (!result?.ok) {
        setVotedTrackIds((previous) => { const next = new Set(previous); next.delete(trackId); return next; });
        setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.map((track) => track.id === trackId ? { ...track, votes: Math.max(0, track.votes - 1) } : track) } : previous);
      } else if (result.alreadyVoted) requestSync();
    });
  }, [socket, votedTrackIds, requestSync]);
  const react = (emoji: typeof reactionChoices[number], button: HTMLButtonElement) => {
    if (!current || !room || !socket) return;
    button.classList.add("pop"); window.setTimeout(() => button.classList.remove("pop"), 400);
    const optimisticMoment: Moment = { id: `pending-${crypto.randomUUID()}`, roomId: room.id, trackId: current.id, userId: identity.userId, name: identity.name, avatar: identity.avatar, emoji, position: effectivePosition(room), createdAt: new Date().toISOString() };
    setMomentBursts((previous) => [...previous, optimisticMoment].slice(-5));
    window.setTimeout(() => setMomentBursts((previous) => previous.filter((item) => item.id !== optimisticMoment.id)), 1_200);
    socket.emit("room:react", { trackId: current.id, emoji, position: optimisticMoment.position });
  };
  const addUrl = async (targetUrl: string, targetPlacement: "last" | "next" = placement, metadata?: SearchItem) => {
    if (!targetUrl.trim()) return;
    setAdding(true); setError("");
    const pendingId = `pending-${crypto.randomUUID()}`;
    const operationId = newOperationId();
    const pendingTrack: Track = {
      id: pendingId,
      url: targetUrl,
      provider: "youtube",
      providerId: metadata?.providerId || "",
      title: metadata?.title || "Resolving YouTube video…",
      artist: metadata?.artist || "Fetching video details",
      thumbnail: metadata?.thumbnail || null,
      duration: metadata?.duration || null,
      addedBy: identity.name,
      addedByUserId: identity.userId,
      position: Math.max(-1, ...(room?.tracks.map((track) => track.position) || [-1])) + 1,
      votes: 0,
      playedAt: null,
      removedAt: null,
      playNext: targetPlacement === "next",
      pending: true,
    };
    setRoom((previous) => previous ? { ...previous, tracks: [...previous.tracks, pendingTrack], queueOrder: [...previous.queueOrder, pendingId] } : previous);
    try {
      const request = () => api<Track | { pending: true; operationId: string }>(`/api/rooms/${code}/tracks`, {
        method: "POST",
        body: JSON.stringify({
          url: targetUrl,
          addedBy: identity.name,
          userId: identity.userId,
          operationId,
          hostToken: getHostToken(code),
          placement: targetPlacement,
          metadata: metadata ? { providerId: metadata.providerId, title: metadata.title, artist: metadata.artist, thumbnail: metadata.thumbnail, duration: metadata.duration } : undefined,
        }),
      });
      let created: Track | { pending: true; operationId: string };
      try { created = await request(); }
      catch (requestError) {
        if (!(requestError instanceof TypeError)) throw requestError;
        created = await request();
      }
      if ("pending" in created) {
        window.setTimeout(requestSync, 500);
        setUrl(""); setPlacement("last"); setSearchOpen(false);
        return;
      }
      setRoom((previous) => previous ? {
        ...previous,
        tracks: previous.tracks.map((track) => track.id === pendingId ? created : track),
        queueOrder: previous.queueOrder.map((id) => id === pendingId ? created.id : id),
        currentTrackId: previous.currentTrackId || created.id,
      } : previous);
      setUrl(""); setPlacement("last"); setSearchOpen(false); setLocalResults([]); setYoutubeResults([]); setNextPageToken(null); setSearchError("");
    }
    catch (err) {
      setRoom((previous) => previous ? { ...previous, tracks: previous.tracks.filter((track) => track.id !== pendingId), queueOrder: previous.queueOrder.filter((id) => id !== pendingId) } : previous);
      setError(err instanceof Error ? err.message : "Could not add that track.");
    }
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
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setRoom((previous) => previous ? { ...previous, queueOrder: [previous.currentTrackId, ...ids].filter((id): id is string => Boolean(id)) } : previous);
    socket?.emit("queue:reorder", { trackIds: ids }, (result: { ok: boolean }) => { if (!result?.ok) requestSync(); });
  };
  const moveToTrack = (sourceId: string, targetId: string) => {
    if (sourceId === targetId || sourceId === current?.id || targetId === current?.id) return;
    const ids = orderedTracks.filter((item) => item.id !== current?.id).map((item) => item.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setRoom((previous) => previous ? { ...previous, queueOrder: [previous.currentTrackId, ...ids].filter((id): id is string => Boolean(id)) } : previous);
    socket?.emit("queue:reorder", { trackIds: ids }, (result: { ok: boolean }) => { if (!result?.ok) requestSync(); });
  };
  const beginTouchDrag = (trackId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    let active = false;
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active && Math.abs(moveEvent.clientY - startY) < 8) return;
      active = true;
      moveEvent.preventDefault();
      setDraggingTrackId(trackId);
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>("[data-track-id]");
      setDragOverTrackId(target?.dataset.trackId || null);
      const list = target?.closest<HTMLElement>(".queue-list");
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (moveEvent.clientY < bounds.top + 48) list.scrollTop -= 18;
        if (moveEvent.clientY > bounds.bottom - 48) list.scrollTop += 18;
      }
    };
    const onEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      const target = document.elementFromPoint(endEvent.clientX, endEvent.clientY)?.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;
      if (active && target) moveToTrack(trackId, target);
      setDraggingTrackId(null);
      setDragOverTrackId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };
  const bulkQueueAction = (action: "remove" | "top" | "bottom") => {
    if (!socket || !selectedTrackIds.size) return;
    if (action === "remove" && !window.confirm(`Remove ${selectedTrackIds.size} selected queue item${selectedTrackIds.size === 1 ? "" : "s"}?`)) return;
    emitReliable(socket, "queue:bulk", { trackIds: [...selectedTrackIds], action, operationId: newOperationId() }, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) { setError(result.error || "Could not update the selected items."); requestSync(); return; }
      setSelectedTrackIds(new Set());
      setSelectionMode(false);
    });
  };
  const saveProfile = () => {
    const next = { ...identity, name: profileName.trim(), avatar: profileAvatar };
    if (!next.name || !socket) return;
    socket.emit("room:profile", next, (result: { ok: boolean; error?: string }) => {
      if (!result.ok) { setError(result.error || "Could not update your profile."); return; }
      saveIdentity(next);
      setPeople((previous) => previous.map((person) => person.userId === identity.userId ? { ...person, ...next } : person));
      setRoom((previous) => previous ? { ...previous, members: previous.members.map((member) => member.userId === identity.userId ? { ...member, name: next.name, avatar: next.avatar } : member) } : previous);
    });
  };
  const copyQueue = async () => { await navigator.clipboard.writeText(orderedTracks.map((track, index) => `${index + 1}. ${room?.partyMode === "blind_pick" && track.id !== room.currentTrackId ? `Mystery pick by ${track.addedBy}` : `${track.title} — ${track.artist}`}`).join("\n") || "Connectify queue is empty"); setQueueMenu(false); };
  const shareDna = async () => { await navigator.clipboard.writeText(`${room?.name || "Our room"} is a ${roomDna.vibe.toLowerCase()} — ${roomDna.contributors} contributors, ${roomDna.topArtist} on repeat, ${roomDna.love}% crowd love. ${window.location.href}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const updateSettings = (settings: Partial<Pick<Room, "autopilotEnabled" | "partyMode" | "theme" | "isLocked" | "guestsCanControl" | "guestsCanAdd" | "maxSongsPerUser" | "maxParticipants" | "chatSlowMode" | "discoverable">>) => {
    setRoom((previous) => previous ? { ...previous, ...settings } : previous);
    socket?.emit("room:settings", settings, (result: { ok: boolean; error?: string }) => { if (!result?.ok) { requestSync(); setError(result?.error || "Could not update the room."); } });
  };
  const removeTrack = (track: Track) => {
    if (!socket || track.pending) return;
    setRoom((previous) => previous ? {
      ...previous,
      tracks: previous.tracks.filter((item) => item.id !== track.id),
      queueOrder: previous.queueOrder.filter((id) => id !== track.id),
    } : previous);
    emitReliable(socket, "queue:remove", { trackId: track.id, operationId: newOperationId() }, (result: { ok: boolean; error?: string }) => { if (!result?.ok) requestSync(); });
  };
  const removeMember = (memberId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the room now? They can use the link to rejoin.`)) return;
    socket?.emit("room:remove", { memberId }, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok) setError(result?.error || `Could not remove ${name}.`);
    });
  };
  const blockMember = (memberId: string, name: string) => {
    if (!window.confirm(`Block ${name} from this room? This guest identity cannot rejoin until you unblock it.`)) return;
    socket?.emit("room:kick", { memberId }, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok) setError(result?.error || `Could not block ${name}.`);
      else loadBlockedMembers();
    });
  };
  const unblockMember = (memberId: string, name: string) => {
    socket?.emit("room:unblock", { memberId }, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok) setError(result?.error || `Could not unblock ${name}.`);
      else setBlockedMembers((members) => members.filter((member) => member.id !== memberId));
    });
  };
  const kickMember = removeMember;
  const clearQueue = () => { if (window.confirm("Clear the entire queue and listening history?")) socket?.emit("queue:clear", {}, () => setQueueMenu(false)); };
  const sendChat = (event: React.FormEvent) => {
    event.preventDefault(); if (!chatBody.trim() || !socket) return;
    emitReliable(socket, "room:chat", { body: chatBody, spoiler: chatSpoiler, trackId: current?.id || null, position: room ? effectivePosition(room) : null, replyToId: replyingTo?.id || null, operationId: newOperationId() }, (result: { ok: boolean; error?: string }) => {
      if (result?.ok) { setChatBody(""); setChatSpoiler(false); setReplyingTo(null); }
      else setError(result?.error || "Could not send that message.");
    });
  };
  const insertMention = (name: string) => {
    setChatBody((body) => body.replace(/(^|\s)@[^@\n]*$/, `$1@${name} `));
  };
  const handleChatScroll = () => {
    const list = chatListRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    setChatAtBottom(atBottom);
    if (atBottom && sideTabRef.current === "chat" && !document.hidden) {
      setUnreadChat(0);
      setFirstUnreadId(null);
    }
    if (list.scrollTop < 72) loadOlderMessages();
  };
  const jumpToLatestChat = () => {
    const list = chatListRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    setChatAtBottom(true);
    setUnreadChat(0);
    setFirstUnreadId(null);
  };
  const openChat = () => {
    setSideTab("chat");
    setQueueMenu(false);
    window.setTimeout(() => {
      const list = chatListRef.current;
      if (!list) return;
      const boundary = firstUnreadId ? list.querySelector<HTMLElement>(`[data-message-id="${firstUnreadId}"]`) : null;
      if (boundary) boundary.scrollIntoView({ block: "start" });
      else list.scrollTop = list.scrollHeight;
      handleChatScroll();
    }, 0);
  };
  const toggleChatNotifications = async () => {
    if (chatNotifications) { setChatNotifications(false); return; }
    if (!("Notification" in window)) { setError("This browser does not support chat notifications."); return; }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission === "granted") setChatNotifications(true);
    else setError("Notifications are blocked in this browser. You can still enable chat sounds.");
  };
  const recoverHost = (event: React.FormEvent) => {
    event.preventDefault();
    if (!socket || !recoveryInput.trim()) return;
    socket.emit("room:recover-host", { recoveryKey: recoveryInput.trim() }, (result: { ok: boolean; error?: string; hostToken?: string }) => {
      if (!result?.ok) { setError(result?.error || "Could not recover this room."); return; }
      if (!result.hostToken) { setError("The room was recovered, but the new recovery key was not returned."); return; }
      saveHostToken(code, result.hostToken);
      setRole("host");
      setRecoveryInput("");
      setRecoveryOpen(false);
      setError("");
    });
  };
  const handoffHost = (member: RoomMember) => {
    if (!socket || !people.some((person) => person.userId === member.userId)) {
      setError("That member must be online before you can hand off the room.");
      return;
    }
    if (!window.confirm(`Make ${member.name} the room host? Your current recovery key will stop working immediately.`)) return;
    socket.emit("room:handoff-host", { targetUserId: member.userId }, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok) { setError(result?.error || "Could not hand off this room."); return; }
      removeHostToken(code);
      setRole("guest");
      setHostOpen(false);
    });
  };
  const copyRecoveryKey = async () => {
    const key = getHostToken(code);
    if (!key) { setError("This device does not have the recovery key. Recover the room first."); return; }
    await navigator.clipboard.writeText(key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const resyncEveryone = () => { if (current && room && canControl) setPlayback(current, room.isPlaying, effectivePosition(room)); };
  const jumpToMessage = (message: ChatMessage) => {
    const track = room?.tracks.find((item) => item.id === message.trackId);
    if (track && message.position !== null) setPlayback(track, true, message.position);
  };
  const enterFullscreen = () => { void document.querySelector<HTMLElement>(".video-stage")?.requestFullscreen?.(); };

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: room?.name || "Connectify",
      artwork: current.thumbnail ? [{ src: current.thumbnail, sizes: "480x360" }] : [],
    });
    navigator.mediaSession.playbackState = room?.isPlaying ? "playing" : "paused";
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ["play", () => setPlayback(current, true, effectivePosition(room!))],
      ["pause", () => setPlayback(current, false, effectivePosition(room!))],
      ["nexttrack", () => skip(1)],
      ["previoustrack", () => skip(-1)],
      ["seekto", (details) => details.seekTime !== undefined && seekPlayback(current, Boolean(room?.isPlaying), details.seekTime)],
    ];
    for (const [action, handler] of actions) {
      try { navigator.mediaSession.setActionHandler(action, handler); }
      catch { /* Some browsers expose only a subset of Media Session actions. */ }
    }
    if (current.duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration: current.duration,
          playbackRate: 1,
          position: Math.min(current.duration, Math.max(0, effectivePosition(room!))),
        });
      } catch { /* Position state is optional. */ }
    }
    return () => {
      for (const [action] of actions) {
        try { navigator.mediaSession.setActionHandler(action, null); }
        catch { /* Ignore unsupported cleanup actions. */ }
      }
    };
  }, [current?.id, current?.title, current?.artist, current?.thumbnail, current?.duration, room?.name, room?.isPlaying, room?.revision, setPlayback, seekPlayback, skip]);

  if (!room) return <main className="room-loading">
    <Brand />
    {error ? <section className="loading-failure">
      <span><WifiOff /></span>
      <h2>{error}</h2>
      {joinErrorCode === "ACCESS_DENIED" && <form className="recovery-import" onSubmit={(event) => {
        event.preventDefault();
        if (!recoveryInput.trim()) return;
        saveHostToken(code, recoveryInput.trim());
        window.location.reload();
      }}>
        <label htmlFor="recovery-key"><KeyRound /> Have this room’s recovery key?</label>
        <div><input id="recovery-key" value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} placeholder="Paste recovery key" autoComplete="off" /><button>Retry as host</button></div>
      </form>}
      <button className="secondary" onClick={() => window.location.reload()}>Retry joining</button>
      <a href="/">Go back home</a>
    </section> :
      <section className="connect-loader" role="status" aria-live="polite">
        <div className="connection-visual" aria-hidden="true">
          <i className="signal-ring" /><i className="signal-ring" /><i className="signal-ring" />
          <i className="signal-disc" />
          <i className="signal-orbit"><b /></i>
          <i className="signal-orbit orbit-two"><b /></i>
          <span className="signal-core"><Radio /></span>
        </div>
        <div className="loading-equalizer" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <p>{joinNotice || (wakingRoom ? "Waking Connectify" : `Tuning in to ${code}`)}{!joinNotice && <span className="loader-dots" aria-hidden="true"><i /><i /><i /></span>}</p>
        <small>{joinNotice ? "Your existing room and queue are unchanged." : wakingRoom ? "Bringing the room and its queue online" : "Syncing the room with everyone"}</small>
      </section>}
  </main>;

  return <main className={`room-shell theme-${room.theme} ${room.partyMode === "watch_party" ? "watch-party" : ""}`}>
    <header className="room-nav">
      <Brand />
      <div className="room-title-mobile"><strong>{room.name}</strong><span><Radio aria-hidden="true" /> Live</span></div>
      <div className="room-nav-actions">
        <div className="listeners"><div className="avatar-stack">{people.slice(0, 4).map((person, index) => <i key={person.id} title={`${person.name}${person.role === "host" ? " · Host" : ""}`}>{person.avatar || avatars[index]}</i>)}</div><span>{people.length} listening</span></div>
        <button className={`sync-pill ${connectionState !== "connected" || syncHealth.buffering ? "waiting" : syncHealth.correcting ? "correcting" : ""}`} onClick={resyncEveryone} disabled={!isHost || !current} title={isHost ? "Resync everyone" : "Playback synchronization health"}>{connectionState === "connected" ? <Wifi /> : <WifiOff />}<span>{connectionState !== "connected" ? "Reconnecting" : syncHealth.buffering ? "Buffering" : syncHealth.correcting ? "Correcting" : `In sync · ${Math.abs(syncHealth.drift).toFixed(1)}s`}</span></button>
        <button className="secondary" onClick={copyInvite}>{copied ? <Check size={17} /> : <Share2 size={17} />}{copied ? "Copied" : "Invite"}</button>
        <div className="menu-wrap"><button className="icon-button" aria-label="Room options" aria-expanded={roomMenu} onClick={() => { setRoomMenu(!roomMenu); setQueueMenu(false); }}><MoreHorizontal /></button>{roomMenu && <div className="action-menu nav-menu"><button onClick={() => { setDnaOpen(true); setRoomMenu(false); }}><Dna />View Room DNA</button><button onClick={() => { setMembersOpen(true); setRoomMenu(false); if (!room.members.length) loadMembers(true); }}><Users />Room profile</button>{isHost ? <button onClick={() => { setHostOpen(true); setRoomMenu(false); if (!room.members.length) loadMembers(true); }}><ShieldCheck />Host controls</button> : <button onClick={() => { setRecoveryOpen(true); setRoomMenu(false); }}><KeyRound />Recover host access</button>}<button onClick={() => { void navigator.clipboard.writeText(room.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); setRoomMenu(false); }}><Copy />Copy room code</button><button onClick={() => { window.location.href = "/"; }}><LogOut />Leave room</button></div>}</div>
      </div>
    </header>

    <section className="room-content">
      <div className="listening-pane">
        <div className="room-heading"><a href="/" aria-label="Leave room"><ArrowLeft /></a><div><div className="live-label"><Radio aria-hidden="true" /> LIVE ROOM · {room.code} · {modeName(room.partyMode).toUpperCase()}</div><h1>{room.name}</h1></div></div>
        {room.partyMode !== "standard" && <div className="party-mode-banner"><Gamepad2 /><div><strong>{modeName(room.partyMode)}</strong><span>{partyModes.find((mode) => mode.id === room.partyMode)?.description}</span></div>{isHost && <button onClick={() => setPartyOpen(true)}>Change</button>}</div>}
        <div className="room-qol-strip">
          <span><Users />{people.length}/{room.maxParticipants} listening</span>
          <span><ListMusic />{orderedTracks.length}/100 queued</span>
          <button onClick={() => setIdentityOpen(true)}>Edit name &amp; avatar</button>
          {isHost && <button onClick={() => setLimitsOpen(true)}><ShieldCheck />Limits</button>}
          {isHost && <button onClick={() => { setActivityOpen(true); if (!activities.length) loadActivity(true); }}><Activity />Activity</button>}
          {isHost && <button onClick={() => { setModerationOpen(true); if (!room.members.length) loadMembers(true); loadBlockedMembers(); }}><UserMinus />Moderate</button>}
        </div>
        {tutorialVisible && <aside className="room-tutorial"><Sparkles /><div><strong>New here?</strong><span>Add or search for a video, then use Queue and Chat to shape the room together.</span></div><button onClick={() => { localStorage.setItem("connectify.roomTutorialDismissed", "true"); setTutorialVisible(false); }}>Got it</button><button className="tutorial-skip" onClick={() => { localStorage.setItem("connectify.roomTutorialDismissed", "true"); setTutorialVisible(false); }} aria-label="Dismiss tutorial"><X /></button></aside>}
        <div className="now-card">
          <div className="video-stage">
            <YouTubePlayer ref={playerRef} track={current} room={room} volume={volume} onEnded={() => skip(1, "ended")} onDuration={(duration) => current && socket?.emit("track:duration", { trackId: current.id, duration })} onSync={setSyncHealth} onAutoplayBlocked={() => setAudioBlocked(true)} onAudioUnlocked={() => setAudioBlocked(false)} onPlaybackIntent={(isPlaying, position) => {
              if (!current || !canControl) return false;
              setPlayback(current, isPlaying, position);
              return true;
            }} />
            {audioBlocked && current && room.isPlaying && <button className="audio-unlock" onClick={() => { playerRef.current?.unlockAudio(); setAudioBlocked(false); }}><Volume2 />Tap to keep this room audible</button>}
            {!current && <div className="empty-record"><ListMusic /><span>Add the first song</span></div>}
            <div className="stage-vignette" />
            <div className="moment-burst-layer">{momentBursts.filter((moment) => moment.trackId === current?.id).map((moment, index) => <span key={moment.id} style={{ "--burst-x": `${18 + index * 16}%` } as React.CSSProperties}><b>{moment.emoji}</b><small>{moment.name}</small></span>)}</div>
            {current && <div className="source-badge">YOUTUBE</div>}
          </div>
          <div className="track-info"><div><span className="now-label">NOW PLAYING</span><h2>{current?.title || "The room is quiet"}</h2><p>{current?.artist || "Paste a YouTube link to get started"}</p></div>{current && <div className="track-info-actions">{room.partyMode === "watch_party" && <button className="icon-button" onClick={enterFullscreen} aria-label="Enter full-screen theater"><Maximize2 /></button>}<a href={current.url} target="_blank" rel="noreferrer" className="icon-button" aria-label="Open source"><Link2 /></a></div>}</div>
          <PlaybackProgress room={room} current={current} onSeek={(position) => seekPlayback(current, room.isPlaying, position)} />
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

      <aside className={`queue-pane ${sideTab === "chat" ? "chat-pane" : ""}`}>
        <div className="queue-header"><div><span>{sideTab === "chat" ? "ROOM CHAT" : room.partyMode === "pass_aux" ? "PASS THE AUX" : "FAIR QUEUE"}</span><h2>{sideTab === "chat" ? "Conversation" : "Room queue"} <small>{sideTab === "chat" ? unreadChat || "" : orderedTracks.length}</small></h2></div>{sideTab === "queue" && <div className="menu-wrap"><button className="icon-button" aria-label="Queue options" aria-expanded={queueMenu} onClick={() => { setQueueMenu(!queueMenu); setRoomMenu(false); }}><MoreHorizontal /></button>{queueMenu && <div className="action-menu queue-menu">{isHost && <button onClick={() => { setPartyOpen(true); setQueueMenu(false); }}><Gamepad2 />Party mode</button>}{isHost && <button onClick={() => { updateSettings({ autopilotEnabled: !room.autopilotEnabled }); setQueueMenu(false); }}><WandSparkles />DJ Autopilot <i className={room.autopilotEnabled ? "toggle on" : "toggle"} /></button>}<button onClick={() => { setHistoryOpen(true); setQueueMenu(false); if (!historyTracks.length) loadHistory(true); }}><History />Listening history</button><button onClick={() => { setFairInfoOpen(true); setQueueMenu(false); }}><Info />How Fair Queue works</button><button onClick={copyQueue}><Copy />Copy queue</button>{isHost && <button onClick={clearQueue}><Trash2 />Clear room queue</button>}</div>}</div>}</div>
        <div className="room-tabs"><button className={sideTab === "queue" ? "active" : ""} onClick={() => setSideTab("queue")}><ListMusic />Queue <small>{orderedTracks.length || ""}</small></button><button className={sideTab === "chat" ? "active" : ""} onClick={openChat}><MessageCircle />Chat <small>{unreadChat || ""}</small></button></div>
        {sideTab === "queue" && <>{room.autopilotEnabled && <div className="autopilot-banner"><WandSparkles /><div><strong>DJ Autopilot is on</strong><span>Crowd favorites return only after fresh picks run out.</span></div>{isHost && <button onClick={() => updateSettings({ autopilotEnabled: false })}><X /></button>}</div>}
        <label className="queue-search"><Search size={17} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search queue" /></label>
        {isHost && <div className={`queue-bulk-bar ${selectionMode ? "active" : ""}`}>
          <button onClick={() => { setSelectionMode((enabled) => !enabled); setSelectedTrackIds(new Set()); }}>{selectionMode ? <X /> : <CheckSquare />}{selectionMode ? "Done" : "Select"}</button>
          {selectionMode && <><span>{selectedTrackIds.size} selected</span><button disabled={!selectedTrackIds.size} onClick={() => bulkQueueAction("top")}><ArrowUp />To top</button><button disabled={!selectedTrackIds.size} onClick={() => bulkQueueAction("bottom")}><ArrowDown />To bottom</button><button className="danger" disabled={!selectedTrackIds.size} onClick={() => bulkQueueAction("remove")}><Trash2 />Remove</button></>}
        </div>}
        <div className="queue-list">
          {filteredTracks.map((track) => {
            const active = track.id === current?.id;
            const blind = room.partyMode === "blind_pick" && !active;
            const queueIndex = orderedTracks.findIndex((item) => item.id === track.id);
            const pendingIndex = orderedTracks.filter((item) => item.id !== current?.id).findIndex((item) => item.id === track.id);
            const pendingCount = orderedTracks.filter((item) => item.id !== current?.id).length;
            return <article key={track.id} data-track-id={track.id} draggable={canControl && !active && !selectionMode} onDragStart={() => setDraggingTrackId(track.id)} onDragOver={(event) => { event.preventDefault(); setDragOverTrackId(track.id); }} onDrop={() => { if (draggingTrackId) moveToTrack(draggingTrackId, track.id); setDraggingTrackId(null); setDragOverTrackId(null); }} onDragEnd={() => { setDraggingTrackId(null); setDragOverTrackId(null); }} className={`queue-item ${active ? "active" : ""} ${track.pending ? "pending" : ""} ${selectedTrackIds.has(track.id) ? "selected" : ""} ${draggingTrackId === track.id ? "dragging" : ""} ${dragOverTrackId === track.id ? "drag-over" : ""}`}>
              {selectionMode && !active ? <button className="queue-select" onClick={() => setSelectedTrackIds((previous) => { const next = new Set(previous); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} aria-label={`Select ${track.title}`}>{selectedTrackIds.has(track.id) ? <CheckSquare /> : <Square />}</button> : canControl && !active && <button className="queue-drag-handle" onPointerDown={(event) => beginTouchDrag(track.id, event)} aria-label={`Drag to reorder ${track.title}`} title="Drag to reorder"><GripVertical /></button>}
              <button className={`queue-thumb ${blind ? "blind" : ""}`} onClick={() => setPlayback(track, true, 0)} disabled={!canControl || blind || track.pending} aria-label={blind ? "Hidden Blind Pick" : `Play ${track.title}`}>{blind ? <EyeOff /> : track.thumbnail ? <img src={track.thumbnail} alt="" /> : <RotateCw />}<span>{active && room.isPlaying ? <i className="equalizer"><b /><b /><b /></i> : <Play size={15} fill="currentColor" />}</span></button>
              <div className="queue-meta"><strong>{blind ? "Mystery pick" : track.title}</strong><span>{blind ? "Revealed when it starts" : track.artist}</span><small>{active ? "Playing now" : track.playNext ? "Pinned to play next" : `In ~${Math.max(1, Math.round((etaByTrack.get(track.id) || 0) / 60))} min · Around ${clockEta(etaByTrack.get(track.id) || 0)}`} · Added by {track.addedBy}</small></div>
              <div className="queue-actions"><button className={votedTrackIds.has(track.id) ? "voted" : ""} onClick={() => vote(track.id)} disabled={votedTrackIds.has(track.id) || track.pending} title={votedTrackIds.has(track.id) ? "Already voted" : "Vote up"}><Heart size={14} fill={votedTrackIds.has(track.id) ? "currentColor" : "none"} />{track.votes || ""}</button><button onClick={() => move(track, -1)} disabled={!canControl || active || pendingIndex <= 0 || track.pending} title="Move up"><ArrowUp size={14} /></button><button onClick={() => move(track, 1)} disabled={!canControl || active || pendingIndex < 0 || pendingIndex === pendingCount - 1 || track.pending} title="Move down"><ArrowDown size={14} /></button><button onClick={() => removeTrack(track)} disabled={!canControl || track.pending || (room.partyMode === "one_take" && active)} title="Remove"><Trash2 size={14} /></button></div>
            </article>;
          })}
          {!filteredTracks.length && <div className="queue-empty"><ListMusic /><strong>{filter ? "No matches" : "Your queue is empty"}</strong><span>{filter ? "Try another search." : "Paste a link to start the music."}</span></div>}
        </div>
        <div className="queue-footer"><RotateCw size={15} /><span>{room.autopilotEnabled ? "Autopilot will keep this session moving" : orderedTracks.length ? `${orderedTracks.length - 1} upcoming · about ${Math.max(1, Math.round(queueDuration / 60))} min` : "Ready for a song"} · Queue {orderedTracks.length}/100</span></div></>}
        {sideTab === "chat" && <div className="room-chat">
          <div className="chat-toolbar"><span>Alerts</span><button className={chatSound ? "active" : ""} onClick={() => setChatSound((enabled) => !enabled)} title={chatSound ? "Turn message sounds off" : "Turn message sounds on"}>{chatSound ? <Volume2 /> : <VolumeX />}Sound</button><button className={chatNotifications ? "active" : ""} onClick={() => void toggleChatNotifications()} title={chatNotifications ? "Turn browser notifications off" : "Turn browser notifications on"}>{chatNotifications ? <Bell /> : <BellOff />}Notify</button></div>
          <div className="chat-list" ref={chatListRef} onScroll={handleChatScroll}>
            {hasMoreChat && <button className="load-older-chat" onClick={loadOlderMessages} disabled={loadingOlderChat}>{loadingOlderChat ? "Loading earlier messages…" : "Load earlier messages"}</button>}
            {room.messages.length ? room.messages.map((message, index) => <ChatMessageRow key={message.id} message={message} previous={room.messages[index - 1]} firstUnreadId={firstUnreadId} canControl={canControl} trackExists={room.tracks.some((track) => track.id === message.trackId)} mentionNames={mentionNames} revealed={revealedSpoilers.has(message.id)} onReveal={() => setRevealedSpoilers((previous) => new Set(previous).add(message.id))} onJump={() => jumpToMessage(message)} onReply={() => setReplyingTo(message)} />) : <div className="chat-empty"><MessageCircle /><strong>The room is quiet</strong><span>Start the conversation. Messages can stay attached to this exact song or video moment.</span></div>}
          </div>
          {(!chatAtBottom || unreadChat > 0) && <button className="jump-latest-chat" onClick={jumpToLatestChat}>{unreadChat ? `${unreadChat} new message${unreadChat === 1 ? "" : "s"}` : "Jump to latest"}<ArrowDown /></button>}
          <form className="chat-compose" onSubmit={sendChat}>
            {replyingTo && <div className="replying-to"><Reply /><span><strong>Replying to {replyingTo.name}</strong><small>{replyingTo.spoiler ? "Spoiler-hidden message" : replyingTo.body}</small></span><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X /></button></div>}
            <textarea value={chatBody} onChange={(event) => setChatBody(event.target.value)} maxLength={300} placeholder="Say something about this moment…" />
            {mentionSuggestions.length > 0 && <div className="mention-suggestions">{mentionSuggestions.map((name) => <button type="button" key={name} onClick={() => insertMention(name)}>@{name}</button>)}</div>}
            <div><label><input type="checkbox" checked={chatSpoiler} onChange={(event) => setChatSpoiler(event.target.checked)} /> Hide as spoiler</label><button disabled={!chatBody.trim()} aria-label="Send message"><Send /></button></div>
          </form>
        </div>}
      </aside>
    </section>

    {current && <div className="mobile-player"><img src={current.thumbnail || ""} alt="" /><div><strong>{current.title}</strong><span>{current.artist}</span></div><button disabled={!canControl} onClick={() => setPlayback(current, !room.isPlaying, effectivePosition(room))}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button disabled={!canControl || room.partyMode === "one_take"} onClick={() => skip(1)}><ChevronRight /></button></div>}
    {removedTrack && <div className="undo-toast"><span><Trash2 />Removed “{removedTrack.title}”</span><button onClick={() => socket?.emit("queue:undo", { trackId: removedTrack.trackId }, (result: { ok: boolean }) => { if (result?.ok) setRemovedTrack(null); })}><Undo2 />Undo</button></div>}
    <div className="activity-toasts" aria-live="polite">{eventToasts.map((toast) => <div key={toast.id}><Activity />{toast.text}</div>)}</div>

    {identityOpen && <FeatureModal title="Your room profile" icon={<Users />} onClose={() => setIdentityOpen(false)}><div className="profile-editor"><div className="avatar-picker">{avatars.map((avatar) => <button key={avatar} className={profileAvatar === avatar ? "active" : ""} onClick={() => setProfileAvatar(avatar)}>{avatar}</button>)}</div><label><span>Guest name</span><input value={profileName} maxLength={30} onChange={(event) => setProfileName(event.target.value)} /></label><button className="primary modal-action" onClick={() => { saveProfile(); setIdentityOpen(false); }} disabled={!profileName.trim()}><Check />Save profile</button></div></FeatureModal>}
    {limitsOpen && <FeatureModal title="Room limits" icon={<ShieldCheck />} onClose={() => setLimitsOpen(false)}><p className="modal-intro">Capacity counts unique listeners, so extra tabs on the same device do not consume another spot. Connectify’s hard limit is 100.</p><div className="limit-settings"><label><span><Users /><b>Room capacity</b><small>Maximum simultaneous unique listeners.</small></span><select value={room.maxParticipants} onChange={(event) => updateSettings({ maxParticipants: Number(event.target.value) })}>{[10, 20, 30, 50, 75, 100].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label><span><MessageCircle /><b>Chat slow mode</b><small>Hosts are exempt. The minimum anti-spam delay remains 0.7s.</small></span><select value={room.chatSlowMode} onChange={(event) => updateSettings({ chatSlowMode: Number(event.target.value) as Room["chatSlowMode"] })}>{[0, 2, 5, 10, 30].map((value) => <option key={value} value={value}>{value === 0 ? "Off" : `${value} seconds`}</option>)}</select></label><div className="capacity-meter"><span><Users />{people.length} of {room.maxParticipants}</span><i><em style={{ width: `${Math.min(100, people.length / room.maxParticipants * 100)}%` }} /></i></div><div className="capacity-meter"><span><ListMusic />{orderedTracks.length} of 100 queue items</span><i><em style={{ width: `${orderedTracks.length}%` }} /></i></div></div></FeatureModal>}
    {activityOpen && <FeatureModal title="Room activity" icon={<Activity />} onClose={() => setActivityOpen(false)}><p className="modal-intro">Moderation and room-rule changes are recorded here. Chat and listening activity stay private.</p><div className="activity-list">{activities.map((event) => <article key={event.id}><Activity /><div><strong>{activityText(event)}</strong><span>{new Date(event.createdAt).toLocaleString()}</span></div></article>)}</div>{activityLoading && <p className="page-loading">Loading activity…</p>}{activityHasMore && <button className="load-page" onClick={() => loadActivity(false)}>Load older activity</button>}{!activityLoading && !activities.length && <div className="modal-empty"><Activity /><strong>No moderation activity yet</strong><span>Important host actions will appear here.</span></div>}</FeatureModal>}
    {dnaOpen && <FeatureModal title="Room DNA" icon={<Dna />} onClose={() => setDnaOpen(false)}><div className="dna-hero"><span>TONIGHT’S VIBE</span><strong>{roomDna.vibe}</strong><p>Built live from what this room plays, loves, and reacts to.</p></div><div className="dna-bars">{[["Energy", roomDna.energy], ["Discovery", roomDna.discovery], ["Togetherness", roomDna.togetherness], ["Crowd love", roomDna.love]].map(([label, value]) => <div key={String(label)}><span>{label}<b>{value}%</b></span><i><em style={{ width: `${value}%` }} /></i></div>)}</div><div className="dna-stats"><div><span>Top artist</span><strong>{roomDna.topArtist}</strong></div><div><span>Chief contributor</span><strong>{roomDna.topContributor}</strong></div><div><span>Shared by</span><strong>{roomDna.contributors} music minds</strong></div></div><button className="primary modal-action" onClick={shareDna}><Share2 />{copied ? "DNA copied" : "Share this Room DNA"}</button></FeatureModal>}
    {fairInfoOpen && <FeatureModal title="Fair Queue" icon={<Sparkles />} onClose={() => setFairInfoOpen(false)}><div className="fair-explainer"><div><b>1</b><span><strong>Everyone gets a turn</strong>Contributors rotate before one person can play twice.</span></div><div><b>2</b><span><strong>Votes still matter</strong>Votes choose which of that contributor’s songs leads their turn.</span></div><div><b>3</b><span><strong>No stale repeats</strong>Played songs leave the fresh queue. Autopilot revives favorites only when it runs dry.</span></div></div></FeatureModal>}
    {partyOpen && <FeatureModal title="Party Modes" icon={<Gamepad2 />} onClose={() => setPartyOpen(false)}><p className="modal-intro">Change the rules for everyone in this persistent room.</p><div className="party-grid">{partyModes.map((mode) => <button key={mode.id} className={room.partyMode === mode.id ? "active" : ""} disabled={!isHost} onClick={() => { updateSettings({ partyMode: mode.id }); setPartyOpen(false); }}><span>{mode.id === "blind_pick" ? <EyeOff /> : mode.id === "one_take" ? <Lock /> : mode.id === "discovery" ? <Sparkles /> : <Gamepad2 />}</span><strong>{mode.name}</strong><small>{mode.description}</small>{room.partyMode === mode.id && <Check />}</button>)}</div>{!isHost && <p className="permission-note">Only the host can change the active mode.</p>}</FeatureModal>}
    {membersOpen && <FeatureModal title="Room Profile" icon={<Users />} onClose={() => setMembersOpen(false)}><div className="room-profile-card"><span>PERMANENT ROOM</span><strong>{room.name}</strong><p>Room {room.code} · Created {new Date(room.createdAt).toLocaleDateString()}</p><button onClick={copyInvite}><Link2 />{copied ? "Link copied" : "Copy permanent room link"}</button></div><div className="profile-section"><h3><Users /> Members <small>{room.memberCount ?? room.members.length}</small></h3><div className="member-list">{room.members.map((member) => <div key={member.id}><i>{member.avatar}</i><span><strong>{member.name}</strong><small>{member.role === "host" ? "Host" : `Last seen ${new Date(member.lastSeenAt).toLocaleDateString()}`}</small></span>{member.role === "host" && <b>HOST</b>}</div>)}</div>{membersLoading && <p className="page-loading">Loading members…</p>}{membersHasMore && <button className="load-page" onClick={() => loadMembers(false)}>Load more members</button>}</div><div className="profile-section"><h3><Palette /> Room theme</h3><div className="theme-picker">{(["violet", "sunset", "ocean", "mono"] as RoomTheme[]).map((theme) => <button key={theme} className={`${theme} ${room.theme === theme ? "active" : ""}`} disabled={!isHost} onClick={() => updateSettings({ theme })} title={theme}><i /></button>)}</div></div></FeatureModal>}
    {historyOpen && <FeatureModal title="Listening History" icon={<History />} onClose={() => setHistoryOpen(false)}>{historyTracks.length ? <><div className="history-list">{historyTracks.map((track, index) => <button key={track.id} disabled={!canControl} onClick={() => { setRoom((previous) => previous && !previous.tracks.some((item) => item.id === track.id) ? { ...previous, tracks: [...previous.tracks, track] } : previous); setPlayback(track, true, 0); setHistoryOpen(false); }}><span>{index + 1}</span><img src={track.thumbnail || ""} alt="" /><div><strong>{track.title}</strong><small>{track.artist} · Added by {track.addedBy}</small></div><Play /></button>)}</div>{historyHasMore && <button className="load-page" onClick={() => loadHistory(false)}>Load more history</button>}</> : historyLoading ? <p className="page-loading">Loading listening history…</p> : <div className="modal-empty"><History /><strong>No listening history yet</strong><span>Finished and skipped songs will stay here for returning members.</span></div>}</FeatureModal>}
    {hostOpen && <FeatureModal title="Host Controls" icon={<ShieldCheck />} onClose={() => setHostOpen(false)}><p className="modal-intro">These rules are enforced by the room server.</p><div className="recovery-card"><KeyRound /><div><strong>Room recovery key</strong><span>Save this somewhere private. It restores host access on another device.</span></div><button onClick={() => void copyRecoveryKey()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy key"}</button></div><div className="host-settings"><button onClick={() => updateSettings({ isLocked: !room.isLocked })}><span><Lock /><b>Lock room</b><small>Only returning members can join.</small></span><i className={room.isLocked ? "toggle on" : "toggle"} /></button><button onClick={() => updateSettings({ guestsCanControl: !room.guestsCanControl })}><span><Play /><b>Guest playback controls</b><small>Allow guests to play, seek, skip, and reorder.</small></span><i className={room.guestsCanControl ? "toggle on" : "toggle"} /></button><button onClick={() => updateSettings({ guestsCanAdd: !room.guestsCanAdd })}><span><Plus /><b>Guest song submissions</b><small>Allow guests to add URLs to the queue.</small></span><i className={room.guestsCanAdd ? "toggle on" : "toggle"} /></button><button onClick={() => updateSettings({ discoverable: !room.discoverable })}><span><Library /><b>Contribute to discovery</b><small>Let video metadata from this room appear in Connectify Library results. Room and member details stay private.</small></span><i className={room.discoverable ? "toggle on" : "toggle"} /></button><label><span><ListMusic /><b>Upcoming songs per guest</b><small>Prevents one listener from flooding the queue.</small></span><select value={room.maxSongsPerUser} onChange={(event) => updateSettings({ maxSongsPerUser: Number(event.target.value) })}>{[1,2,3,5,8,10,15,20].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div><div className="profile-section moderation"><h3><Users /> Members and host handoff</h3><p className="section-help">Handoff rotates the recovery key and works only for someone currently online.</p><div className="member-list">{room.members.map((member) => <div key={member.id}><i>{member.avatar}</i><span><strong>{member.name}</strong><small>{member.role === "host" ? "Room host" : people.some((person) => person.userId === member.userId) ? "Online" : "Offline"}</small></span>{member.role === "guest" && <div className="member-actions">{people.some((person) => person.userId === member.userId) && <button className="handoff" onClick={() => handoffHost(member)} title={`Make ${member.name} the host`}><UserRoundCheck /></button>}<button onClick={() => kickMember(member.id, member.name)} title={`Remove ${member.name}`}><UserMinus /></button></div>}</div>)}</div>{membersLoading && <p className="page-loading">Loading members…</p>}{membersHasMore && <button className="load-page" onClick={() => loadMembers(false)}>Load more members</button>}</div></FeatureModal>}
    {moderationOpen && <FeatureModal title="Listener moderation" icon={<UserMinus />} onClose={() => setModerationOpen(false)}>
      <p className="modal-intro">Removing disconnects someone now; blocking prevents this guest identity from rejoining until you unblock it.</p>
      <div className="moderation-groups">
        <section>
          <h3>Room members</h3>
          <div className="moderation-list">{room.members.filter((member) => member.role !== "host").map((member) => <article key={member.id}><i>{member.avatar}</i><span><strong>{member.name}</strong><small>{people.some((person) => person.userId === member.userId) ? "Online now" : "Offline"}</small></span><div><button onClick={() => removeMember(member.id, member.name)}>Remove now</button><button className="danger" onClick={() => blockMember(member.id, member.name)}>Block</button></div></article>)}</div>
          {membersLoading && <p className="page-loading">Loading members…</p>}
          {membersHasMore && <button className="load-page" onClick={() => loadMembers(false)}>Load more members</button>}
          {!room.members.some((member) => member.role !== "host") && <p className="section-help">No guests have joined this room yet.</p>}
        </section>
        <section>
          <h3>Blocked identities <small>{blockedMembers.length}</small></h3>
          <div className="moderation-list">{blockedMembers.map((member) => <article key={member.id}><i>{member.avatar}</i><span><strong>{member.name}</strong><small>Blocked from this room</small></span><div><button onClick={() => unblockMember(member.id, member.name)}>Unblock</button></div></article>)}</div>
          {!blockedMembers.length && <p className="section-help">No one is blocked.</p>}
        </section>
      </div>
    </FeatureModal>}
    {recoveryOpen && <FeatureModal title="Recover Host Access" icon={<KeyRound />} onClose={() => setRecoveryOpen(false)}><p className="modal-intro">Paste the private recovery key saved by the room host. Recovering access makes this device the host and demotes the previous host.</p><form className="recover-host-form" onSubmit={recoverHost}><input value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} placeholder="Room recovery key" autoComplete="off" /><button className="primary" disabled={!recoveryInput.trim()}><KeyRound />Recover room</button></form></FeatureModal>}
  </main>;
}
