import { useEffect, useRef } from "react";
import type { Room, Track } from "./types";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
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

function effectivePosition(room: Room) {
  if (!room.isPlaying || !room.startedAt) return room.playbackPosition;
  return room.playbackPosition + Math.max(0, (Date.now() - new Date(room.startedAt).getTime()) / 1000);
}

export function YouTubePlayer({ track, room, volume, onEnded }: { track: Track; room: Room; volume: number; onEnded: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current) return;
      playerRef.current = new window.YT.Player(mountRef.current, {
        videoId: track.providerId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            playerRef.current.setVolume(volume);
            playerRef.current.seekTo(effectivePosition(room), true);
            room.isPlaying ? playerRef.current.playVideo() : playerRef.current.pauseVideo();
          },
          onStateChange: (event: any) => { if (event.data === window.YT.PlayerState.ENDED) onEnded(); },
        },
      });
    });
    return () => { cancelled = true; playerRef.current?.destroy?.(); playerRef.current = null; };
  }, [track.id]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player?.seekTo) return;
    const target = effectivePosition(room);
    const current = Number(player.getCurrentTime?.() || 0);
    if (Math.abs(current - target) > 1.5) player.seekTo(target, true);
    room.isPlaying ? player.playVideo() : player.pauseVideo();
  }, [room.revision, room.isPlaying]);

  useEffect(() => { playerRef.current?.setVolume?.(volume); }, [volume]);

  return <div className="youtube-player" ref={mountRef} aria-label={`Playing ${track.title}`} />;
}
