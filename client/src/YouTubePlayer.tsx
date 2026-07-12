import { useEffect, useRef } from "react";
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
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiPromise;
}

type SyncReport = { drift: number; correcting: boolean; buffering: boolean };

export function YouTubePlayer({ track, room, volume, onEnded, onDuration, onSync }: {
  track: Track; room: Room; volume: number; onEnded: () => void; onDuration: (duration: number) => void; onSync: (report: SyncReport) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const endedRef = useRef(onEnded);
  const durationRef = useRef(onDuration);
  const syncRef = useRef(onSync);
  const roomRef = useRef(room);
  const volumeRef = useRef(volume);
  const knownDurationRef = useRef(track.duration);
  endedRef.current = onEnded; durationRef.current = onDuration; syncRef.current = onSync; roomRef.current = room; volumeRef.current = volume; knownDurationRef.current = track.duration;

  useEffect(() => {
    let cancelled = false;
    let syncTimer: number | undefined;
    const reportDuration = () => {
      const duration = Number(playerRef.current?.getDuration?.() || 0);
      if (duration > 0 && !knownDurationRef.current) durationRef.current(duration);
    };
    const checkSync = () => {
      const player = playerRef.current;
      const currentRoom = roomRef.current;
      if (!player?.getCurrentTime || !currentRoom.isPlaying) return;
      const target = effectivePosition(currentRoom);
      const current = Number(player.getCurrentTime() || 0);
      const drift = current - target;
      const buffering = player.getPlayerState?.() === window.YT.PlayerState.BUFFERING;
      const correcting = Math.abs(drift) > 1.25 && !buffering;
      if (correcting) player.seekTo(target, true);
      syncRef.current({ drift, correcting, buffering });
      reportDuration();
    };
    loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current) return;
      const target = document.createElement("div");
      mountRef.current.replaceChildren(target);
      playerRef.current = new window.YT.Player(target, {
        videoId: track.providerId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            const currentRoom = roomRef.current;
            playerRef.current.setVolume(volumeRef.current);
            playerRef.current.seekTo(effectivePosition(currentRoom), true);
            currentRoom.isPlaying ? playerRef.current.playVideo() : playerRef.current.pauseVideo();
            window.setTimeout(reportDuration, 800);
            syncTimer = window.setInterval(checkSync, 4000);
          },
          onStateChange: (event: any) => {
            if (event.data === window.YT.PlayerState.ENDED) endedRef.current();
            if (event.data === window.YT.PlayerState.PLAYING) reportDuration();
            if (event.data === window.YT.PlayerState.BUFFERING) syncRef.current({ drift: 0, correcting: false, buffering: true });
          },
          onError: () => syncRef.current({ drift: 0, correcting: false, buffering: true }),
        },
      });
    });
    return () => { cancelled = true; if (syncTimer) window.clearInterval(syncTimer); playerRef.current?.destroy?.(); playerRef.current = null; mountRef.current?.replaceChildren(); };
  }, [track.id]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player?.seekTo) return;
    const target = effectivePosition(room);
    const current = Number(player.getCurrentTime?.() || 0);
    const drift = current - target;
    const correcting = Math.abs(drift) > 1.25;
    if (correcting) player.seekTo(target, true);
    syncRef.current({ drift, correcting, buffering: false });
    room.isPlaying ? player.playVideo() : player.pauseVideo();
  }, [room.revision, room.isPlaying]);

  useEffect(() => { playerRef.current?.setVolume?.(volume); }, [volume]);
  return <div className="youtube-player" ref={mountRef} aria-label={`Playing ${track.title}`} />;
}
