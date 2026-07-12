import type { Room } from "./types";

export function effectivePosition(room: Room, now = Date.now()) {
  if (!room.isPlaying || !room.startedAt) return room.playbackPosition;
  const serverAtSnapshot = new Date(room.serverTime).getTime();
  const playbackStartedAt = new Date(room.startedAt).getTime();
  const receivedAt = room.receivedAt || now;
  const elapsedBeforeSnapshot = Math.max(0, (serverAtSnapshot - playbackStartedAt) / 1000);
  const elapsedAfterSnapshot = Math.max(0, (now - receivedAt) / 1000);
  return room.playbackPosition + elapsedBeforeSnapshot + elapsedAfterSnapshot;
}

export function withReceipt(room: Room): Room {
  return { ...room, receivedAt: Date.now() };
}
