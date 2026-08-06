import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { effectivePosition } from "./playback";
import type { Room, Track } from "./types";

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void; }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

type SyncReport = { drift: number; correcting: boolean; buffering: boolean };

// Corrective seeks are suppressed for this long after loading a new video, so early
// buffering does not trigger a seek/correction loop (the worst of the background jitter).
const STARTUP_GRACE_MS = 2_500;
// Fatal player errors that mean the video will never play and the room should move on.
const FATAL_ERROR_CODES = new Set([2, 5, 100, 101, 150]);

// Lightweight, listenable instrumentation for player state transitions so background
// jitter reports are diagnosable after the fact (see docs multi-device test matrix).
function emitPlayerEvent(type: string, detail: Record<string, unknown> = {}) {
  try { window.dispatchEvent(new CustomEvent("connectify:player", { detail: { type, hidden: document.hidden, ...detail } })); }
  catch { /* Instrumentation is best-effort. */ }
}

export type YouTubePlayerHandle = { unlockAudio: () => void };

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, {
  track: Track | null;
  room: Room;
  volume: number;
  onEnded: () => void;
  onDuration: (duration: number) => void;
  onSync: (report: SyncReport) => void;
  onPlaybackIntent: (isPlaying: boolean, position: number) => boolean;
  onAutoplayBlocked: () => void;
  onAudioUnlocked: () => void;
  onError: () => void;
}>(function YouTubePlayer({ track, room, volume, onEnded, onDuration, onSync, onPlaybackIntent, onAutoplayBlocked, onAudioUnlocked, onError }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const preloadMountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const preloadRef = useRef<any>(null);
  const trackRef = useRef(track);
  const roomRef = useRef(room);
  const volumeRef = useRef(volume);
  const endedRef = useRef(onEnded);
  const durationRef = useRef(onDuration);
  const syncRef = useRef(onSync);
  const playbackIntentRef = useRef(onPlaybackIntent);
  const autoplayBlockedRef = useRef(onAutoplayBlocked);
  const audioUnlockedRef = useRef(onAudioUnlocked);
  const errorRef = useRef(onError);
  const loadedVideoRef = useRef<string | null>(null);
  const endedVideoRef = useRef<string | null>(null);
  const erroredVideoRef = useRef<string | null>(null);
  const preloadedVideoRef = useRef<string | null>(null);
  const loadedAtRef = useRef(0);
  const readyRef = useRef(false);
  const preloadReadyRef = useRef(false);
  trackRef.current = track;
  roomRef.current = room;
  volumeRef.current = volume;
  endedRef.current = onEnded;
  durationRef.current = onDuration;
  syncRef.current = onSync;
  playbackIntentRef.current = onPlaybackIntent;
  autoplayBlockedRef.current = onAutoplayBlocked;
  audioUnlockedRef.current = onAudioUnlocked;
  errorRef.current = onError;

  const checkAutoplay = () => {
    window.setTimeout(() => {
      // A backgrounded, throttled tab is legitimately not "playing"; don't cry autoplay-blocked.
      if (document.hidden) return;
      const state = playerRef.current?.getPlayerState?.();
      if (roomRef.current.isPlaying && state !== window.YT?.PlayerState?.PLAYING && state !== window.YT?.PlayerState?.BUFFERING) {
        emitPlayerEvent("autoplay-blocked");
        autoplayBlockedRef.current();
      }
    }, 2_200);
  };

  // Warm the next track in a hidden, muted player so the real transition loads faster.
  const maybePreloadNext = () => {
    const player = preloadRef.current;
    const currentRoom = roomRef.current;
    const currentTrack = trackRef.current;
    if (!preloadReadyRef.current || !player) return;
    const nextId = currentRoom.queueOrder[1];
    const nextTrack = nextId ? currentRoom.tracks.find((item) => item.id === nextId) : null;
    const providerId = nextTrack && !nextTrack.pending && nextTrack.providerId ? nextTrack.providerId : null;
    if (!providerId || providerId === currentTrack?.providerId || providerId === preloadedVideoRef.current) return;
    preloadedVideoRef.current = providerId;
    try {
      player.mute?.();
      player.cueVideoById({ videoId: providerId, startSeconds: 0 });
      emitPlayerEvent("precue", { providerId });
    } catch { /* Preload is best-effort. */ }
  };

  const synchronize = (force = false) => {
    const player = playerRef.current;
    const currentTrack = trackRef.current;
    const currentRoom = roomRef.current;
    if (!readyRef.current || !player) return;
    // A pending track with known metadata is still worth cueing so playback pre-buffers;
    // only a truly empty/unresolved slot clears the player.
    if (!currentTrack || (currentTrack.pending && !currentTrack.providerId)) {
      if (loadedVideoRef.current !== null) {
        player.stopVideo?.();
        player.clearVideo?.();
        loadedVideoRef.current = null;
        endedVideoRef.current = null;
        erroredVideoRef.current = null;
      }
      syncRef.current({ drift: 0, correcting: false, buffering: false });
      return;
    }
    const target = Math.max(0, effectivePosition(currentRoom));
    if (loadedVideoRef.current !== currentTrack.providerId) {
      loadedVideoRef.current = currentTrack.providerId;
      endedVideoRef.current = null;
      erroredVideoRef.current = null;
      loadedAtRef.current = Date.now();
      const request = { videoId: currentTrack.providerId, startSeconds: target };
      if (currentRoom.isPlaying) { player.loadVideoById(request); checkAutoplay(); }
      else player.cueVideoById(request);
      player.setVolume(volumeRef.current);
      emitPlayerEvent("load", { providerId: currentTrack.providerId, playing: currentRoom.isPlaying, startSeconds: Math.round(target) });
      return;
    }
    const current = Number(player.getCurrentTime?.() || 0);
    const drift = current - target;
    const buffering = player.getPlayerState?.() === window.YT.PlayerState.BUFFERING;
    const withinGrace = Date.now() - loadedAtRef.current < STARTUP_GRACE_MS;
    // Never issue a corrective seek while buffering, inside the startup grace window, or in a
    // hidden/throttled tab — those are exactly the conditions that turn one seek into a loop.
    const correcting = (force ? Math.abs(drift) > 0.45 : Math.abs(drift) > 1.25) && !buffering && !withinGrace && !document.hidden;
    if (correcting) { player.seekTo(target, true); emitPlayerEvent("seek-correction", { drift: Number(drift.toFixed(2)) }); }
    const playerState = player.getPlayerState?.();
    if (!document.hidden && currentRoom.isPlaying && playerState !== window.YT.PlayerState.PLAYING && playerState !== window.YT.PlayerState.BUFFERING) { player.playVideo(); checkAutoplay(); }
    if (!currentRoom.isPlaying && playerState === window.YT.PlayerState.PLAYING) player.pauseVideo();
    syncRef.current({ drift, correcting, buffering });
  };

  useEffect(() => {
    let cancelled = false;
    let syncTimer: number | undefined;
    const reportDuration = () => {
      const duration = Number(playerRef.current?.getDuration?.() || 0);
      if (duration > 0 && !trackRef.current?.duration) durationRef.current(duration);
    };
    void loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current) return;
      const target = document.createElement("div");
      mountRef.current.replaceChildren(target);
      playerRef.current = new window.YT.Player(target, {
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            const iframe = playerRef.current.getIframe?.() as HTMLIFrameElement | undefined;
            if (iframe) {
              const permissions = new Set((iframe.allow || "").split(";").map((value) => value.trim()).filter(Boolean));
              permissions.add("autoplay");
              permissions.add("picture-in-picture");
              iframe.allow = [...permissions].join("; ");
            }
            playerRef.current.setVolume(volumeRef.current);
            synchronize(true);
            syncTimer = window.setInterval(() => { synchronize(); reportDuration(); maybePreloadNext(); }, 4_000);
          },
          onStateChange: (event: any) => {
            const currentTrack = trackRef.current;
            const playbackIntent = event.data === window.YT.PlayerState.PLAYING ? true : event.data === window.YT.PlayerState.PAUSED ? false : null;
            const iframe = playerRef.current?.getIframe?.() as HTMLIFrameElement | undefined;
            const playerWasFocused = Boolean(iframe && document.activeElement === iframe);
            if (playbackIntent !== null && playerWasFocused) {
              iframe?.blur();
              if (!document.hidden && currentTrack && !currentTrack.pending && playbackIntent !== roomRef.current.isPlaying) {
                const accepted = playbackIntentRef.current(playbackIntent, Number(playerRef.current?.getCurrentTime?.() || 0));
                if (!accepted) window.setTimeout(() => synchronize(true), 0);
              }
            }
            if (event.data === window.YT.PlayerState.ENDED && currentTrack && endedVideoRef.current !== currentTrack.providerId) {
              endedVideoRef.current = currentTrack.providerId;
              emitPlayerEvent("ended", { providerId: currentTrack.providerId });
              endedRef.current();
            }
            if (event.data === window.YT.PlayerState.PLAYING) { reportDuration(); audioUnlockedRef.current(); }
            if (event.data === window.YT.PlayerState.BUFFERING) syncRef.current({ drift: 0, correcting: false, buffering: true });
          },
          onError: (event: any) => {
            const errorCode = Number(event?.data);
            const currentTrack = trackRef.current;
            emitPlayerEvent("error", { errorCode, providerId: currentTrack?.providerId });
            if (currentTrack && erroredVideoRef.current !== currentTrack.providerId && FATAL_ERROR_CODES.has(errorCode)) {
              erroredVideoRef.current = currentTrack.providerId;
              syncRef.current({ drift: 0, correcting: false, buffering: false });
              errorRef.current();
              return;
            }
            syncRef.current({ drift: 0, correcting: false, buffering: true });
          },
        },
      });
      if (preloadMountRef.current) {
        const preTarget = document.createElement("div");
        preloadMountRef.current.replaceChildren(preTarget);
        preloadRef.current = new window.YT.Player(preTarget, {
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, mute: 1 },
          events: {
            onReady: () => {
              preloadReadyRef.current = true;
              try { preloadRef.current.mute?.(); preloadRef.current.setVolume?.(0); } catch { /* noop */ }
              maybePreloadNext();
            },
          },
        });
      }
    });
    const recover = () => { if (!document.hidden) window.setTimeout(() => synchronize(true), 50); };
    document.addEventListener("visibilitychange", recover);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    return () => {
      cancelled = true;
      if (syncTimer) window.clearInterval(syncTimer);
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      readyRef.current = false;
      preloadReadyRef.current = false;
      playerRef.current?.destroy?.();
      preloadRef.current?.destroy?.();
      playerRef.current = null;
      preloadRef.current = null;
      mountRef.current?.replaceChildren();
      preloadMountRef.current?.replaceChildren();
    };
  }, []);

  useEffect(() => { synchronize(true); maybePreloadNext(); }, [track?.id, room.revision, room.isPlaying, room.playbackPosition, room.startedAt]);
  useEffect(() => { playerRef.current?.setVolume?.(volume); }, [volume]);
  useImperativeHandle(ref, () => ({
    unlockAudio: () => {
      playerRef.current?.playVideo?.();
      window.setTimeout(() => synchronize(true), 50);
    },
  }), []);

  const hasPlayableTrack = Boolean(track && (!track.pending || track.providerId));
  return <>
    <div className={`youtube-player ${hasPlayableTrack ? "" : "is-empty"}`} ref={mountRef} aria-label={hasPlayableTrack ? `Playing ${track!.title}` : "YouTube player waiting for a track"} />
    <div ref={preloadMountRef} aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, left: -9999, top: 0, opacity: 0, pointerEvents: "none" }} />
  </>;
});
