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
  const endedRef = useRef(onEnded);
  const roomRef = useRef(room);
  const volumeRef = useRef(volume);
  endedRef.current = onEnded;
  roomRef.current = room;
  volumeRef.current = volume;

  useEffect(() => {
    let cancelled = false;
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
          },
          onStateChange: (event: any) => { if (event.data === window.YT.PlayerState.ENDED) endedRef.current(); },
        },
      });
    });
    return () => { cancelled = true; playerRef.current?.destroy?.(); playerRef.current = null; mountRef.current?.replaceChildren(); };
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
