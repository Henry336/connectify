export function joinRoomDenial(input: { isLocked: boolean; isReturning: boolean; isHost: boolean; isBanned: boolean }) {
  if (input.isBanned) return "You were removed from this room.";
  if (input.isLocked && !input.isReturning && !input.isHost) return "This room is locked to returning members.";
  return null;
}

export function addTrackDenial(input: { isLocked: boolean; isReturning: boolean; isHost: boolean; isBanned: boolean; guestsCanAdd: boolean; pending: number; limit: number }) {
  if (input.isBanned) return "You were removed from this room.";
  if (input.isLocked && !input.isReturning && !input.isHost) return "This room is locked.";
  if (!input.isHost && !input.guestsCanAdd) return "Only the host can add songs right now.";
  if (!input.isHost && input.pending >= input.limit) return `You can have up to ${input.limit} upcoming songs at once.`;
  return null;
}

export function artistAllowed(partyMode: string, existingArtists: string[], nextArtist: string) {
  return partyMode !== "discovery" || !existingArtists.some((artist) => artist.localeCompare(nextArtist, undefined, { sensitivity: "accent" }) === 0);
}

export function trackChangeAllowed(partyMode: string, currentTrackId: string | null, nextTrackId: string) {
  return partyMode !== "one_take" || !currentTrackId || currentTrackId === nextTrackId;
}

export function advanceAllowed(partyMode: string, reason: "manual" | "ended") {
  return partyMode !== "one_take" || reason === "ended";
}

export function publicJoinFailure(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  const schemaUnavailable = candidate?.code === "P2022"
    || /column .* does not exist|migration|schema/i.test(String(candidate?.message || ""));
  return schemaUnavailable
    ? { ok: false as const, code: "SERVICE_UPDATING", retryable: true, error: "Connectify is finishing an update. Your room is safe; retrying automatically…" }
    : { ok: false as const, code: "JOIN_FAILED", retryable: true, error: "Connectify could not finish joining yet. Retrying automatically…" };
}

export function endedPlaybackAllowed(input: {
  currentTrackId: string | null;
  expectedTrackId: string;
  isPlaying: boolean;
  duration: number | null | undefined;
  playbackPosition: number;
  startedAt: Date | null;
  now?: number;
}) {
  if (input.currentTrackId !== input.expectedTrackId || !input.isPlaying || !input.duration) return false;
  const elapsed = input.playbackPosition + (input.startedAt ? Math.max(0, ((input.now ?? Date.now()) - input.startedAt.getTime()) / 1000) : 0);
  return elapsed >= input.duration - 4;
}
