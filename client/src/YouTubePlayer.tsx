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
}>(function YouTubePlayer({ track, room, volume, onEnded, onDuration, onSync, onPlaybackIntent, onAutoplayBlocked, onAudioUnlocked }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const trackRef = useRef(track);
  const roomRef = useRef(room);
  const volumeRef = useRef(volume);
  const endedRef = useRef(onEnded);
  const durationRef = useRef(onDuration);
  const syncRef = useRef(onSync);
  const playbackIntentRef = useRef(onPlaybackIntent);
  const autoplayBlockedRef = useRef(onAutoplayBlocked);
  const audioUnlockedRef = useRef(onAudioUnlocked);
  const loadedVideoRef = useRef<string | null>(null);
  const endedVideoRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  trackRef.current = track;
  roomRef.current = room;
  volumeRef.current = volume;
  endedRef.current = onEnded;
  durationRef.current = onDuration;
  syncRef.current = onSync;
  playbackIntentRef.current = onPlaybackIntent;
  autoplayBlockedRef.current = onAutoplayBlocked;
  audioUnlockedRef.current = onAudioUnlocked;

  const checkAutoplay = () => {
    window.setTimeout(() => {
      const state = playerRef.current?.getPlayerState?.();
      if (roomRef.current.isPlaying && state !== window.YT?.PlayerState?.PLAYING && state !== window.YT?.PlayerState?.BUFFERING) {
        autoplayBlockedRef.current();
      }
    }, 2_200);
  };

  const synchronize = (force = false) => {
    const player = playerRef.current;
    const currentTrack = trackRef.current;
    const currentRoom = roomRef.current;
    if (!readyRef.current || !player) return;
    if (!currentTrack || currentTrack.pending) {
      if (loadedVideoRef.current !== null) {
        player.stopVideo?.();
        player.clearVideo?.();
        loadedVideoRef.current = null;
        endedVideoRef.current = null;
      }
      syncRef.current({ drift: 0, correcting: false, buffering: false });
      return;
    }
    const target = Math.max(0, effectivePosition(currentRoom));
    if (loadedVideoRef.current !== currentTrack.providerId) {
      loadedVideoRef.current = currentTrack.providerId;
      endedVideoRef.current = null;
      const request = { videoId: currentTrack.providerId, startSeconds: target };
      if (currentRoom.isPlaying) { player.loadVideoById(request); checkAutoplay(); }
      else player.cueVideoById(request);
      player.setVolume(volumeRef.current);
      return;
    }
    const current = Number(player.getCurrentTime?.() || 0);
    const drift = current - target;
    const buffering = player.getPlayerState?.() === window.YT.PlayerState.BUFFERING;
    const correcting = (force ? Math.abs(drift) > 0.45 : Math.abs(drift) > 1.25) && !buffering;
    if (correcting) player.seekTo(target, true);
    const playerState = player.getPlayerState?.();
    if (currentRoom.isPlaying && playerState !== window.YT.PlayerState.PLAYING && playerState !== window.YT.PlayerState.BUFFERING) { player.playVideo(); checkAutoplay(); }
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
            syncTimer = window.setInterval(() => { synchronize(); reportDuration(); }, 4_000);
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
              endedRef.current();
            }
            if (event.data === window.YT.PlayerState.PLAYING) reportDuration();
            if (event.data === window.YT.PlayerState.PLAYING) audioUnlockedRef.current();
            if (event.data === window.YT.PlayerState.BUFFERING) syncRef.current({ drift: 0, correcting: false, buffering: true });
          },
          onError: () => syncRef.current({ drift: 0, correcting: false, buffering: true }),
        },
      });
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
      playerRef.current?.destroy?.();
      playerRef.current = null;
      mountRef.current?.replaceChildren();
    };
  }, []);

  useEffect(() => { synchronize(true); }, [track?.id, room.revision, room.isPlaying, room.playbackPosition, room.startedAt]);
  useEffect(() => { playerRef.current?.setVolume?.(volume); }, [volume]);
  useImperativeHandle(ref, () => ({
    unlockAudio: () => {
      playerRef.current?.playVideo?.();
      window.setTimeout(() => synchronize(true), 50);
    },
  }), []);

  const hasPlayableTrack = Boolean(track && !track.pending);
  return <div className={`youtube-player ${hasPlayableTrack ? "" : "is-empty"}`} ref={mountRef} aria-label={hasPlayableTrack ? `Playing ${track!.title}` : "YouTube player waiting for a track"} />;
});
