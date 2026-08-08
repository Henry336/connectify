// Pure helpers for Smart Autoplay discovery: which artists define this room's taste,
// how to split a refill between familiar revivals and fresh finds, and which fresh
// candidates to actually queue. Kept dependency-free so they stay unit-testable.

export type ArtistSignal = { artist: string; votes: number; playedAt?: Date | string | null; title?: string };

export const AUTOPLAY_TRIGGER_MAX_UPCOMING = 2;
export const AUTOPLAY_IDLE_MS = 3 * 60_000;

export function autoplayRefillNeed(input: {
  upcomingCount: number;
  targetBuffer: number;
  lastHumanAddedAt?: Date | string | null;
  now?: number;
}) {
  if (input.upcomingCount > AUTOPLAY_TRIGGER_MAX_UPCOMING) return 0;
  const lastHumanAdded = input.lastHumanAddedAt ? new Date(input.lastHumanAddedAt).getTime() : 0;
  if (lastHumanAdded && (input.now ?? Date.now()) - lastHumanAdded < AUTOPLAY_IDLE_MS) return 0;
  return Math.max(0, Math.max(3, input.targetBuffer) - input.upcomingCount);
}

// Ranks the artists a room demonstrably cares about: every appearance counts, votes
// count double, and a completed play adds one more.
export function topArtists(tracks: ArtistSignal[], limit = 3): string[] {
  const scores = new Map<string, number>();
  for (const track of tracks) {
    const artist = track.artist.trim();
    if (!artist || artist.toLowerCase() === "youtube") continue;
    scores.set(artist, (scores.get(artist) || 0) + 1 + track.votes * 2 + (track.playedAt ? 1 : 0));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([artist]) => artist);
}

// Searches across pairs of the room's strongest signals instead of repeatedly asking
// YouTube for one artist's catalogue. The "similar music" wording deliberately widens
// results toward adjacent artists while retaining the room's accumulated taste.
export function discoveryQueries(tracks: ArtistSignal[], limit = 6): string[] {
  const artists = topArtists(tracks, limit);
  if (!artists.length) return [];
  if (artists.length === 1) return [`music similar to ${artists[0]}`];
  return artists.map((artist, index) => `${artist} ${artists[(index + 1) % artists.length]} similar music`);
}

// Splits a refill of `need` tracks by the room's Familiar↔Fresh setting (0–100).
// Without a ready discovery pool everything falls back to familiar revivals.
export function splitAutoplay(need: number, freshness: number, poolReady: boolean) {
  if (need <= 0) return { fresh: 0, revive: 0 };
  const clamped = Math.min(100, Math.max(0, freshness));
  const fresh = poolReady ? Math.min(need, Math.round((need * clamped) / 100)) : 0;
  return { fresh, revive: need - fresh };
}

export type DiscoveryCandidate = { providerId: string; artist: string };

// Chooses fresh tracks from a candidate pool: never anything the room already has,
// no duplicates, and artists already upcoming are spaced out before repeats top up.
export function pickDiscovery<T extends DiscoveryCandidate>(pool: T[], exclude: Set<string>, need: number, upcomingArtists: string[] = []): T[] {
  if (need <= 0) return [];
  const picked: T[] = [];
  const seen = new Set<string>();
  const usedArtists = new Set(upcomingArtists.map((artist) => artist.toLowerCase()));
  for (const item of pool) {
    if (picked.length >= need) break;
    if (exclude.has(item.providerId) || seen.has(item.providerId)) continue;
    if (usedArtists.has(item.artist.toLowerCase())) continue;
    seen.add(item.providerId);
    usedArtists.add(item.artist.toLowerCase());
    picked.push(item);
  }
  // If artist spacing left the pick short, allow repeats before letting the queue run dry.
  for (const item of pool) {
    if (picked.length >= need) break;
    if (exclude.has(item.providerId) || seen.has(item.providerId)) continue;
    seen.add(item.providerId);
    picked.push(item);
  }
  return picked;
}
