export type ResolvedTrack = {
  url: string;
  provider: "youtube";
  providerId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number | null;
};

export type ProvidedTrackMetadata = {
  providerId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  duration?: number | null;
};

const metadataCache = new Map<string, { expiresAt: number; value: ResolvedTrack }>();
const METADATA_TTL = 24 * 60 * 60 * 1000;
const MAX_METADATA_ENTRIES = 1_000;

function cacheMetadata(value: ResolvedTrack) {
  metadataCache.delete(value.providerId);
  metadataCache.set(value.providerId, { expiresAt: Date.now() + METADATA_TTL, value });
  while (metadataCache.size > MAX_METADATA_ENTRIES) metadataCache.delete(metadataCache.keys().next().value!);
}

export function getYouTubeId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id: string | null = null;

    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|embed)\//.test(url.pathname)) id = url.pathname.split("/")[2] ?? null;
    }

    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function resolveTrack(value: string, provided?: ProvidedTrackMetadata): Promise<ResolvedTrack> {
  const providerId = getYouTubeId(value);
  if (!providerId) throw new Error("Paste a valid YouTube video or music URL.");

  const url = `https://www.youtube.com/watch?v=${providerId}`;
  if (provided?.providerId === providerId) {
    const resolved = {
      url,
      provider: "youtube" as const,
      providerId,
      title: provided.title.trim(),
      artist: provided.artist.trim(),
      thumbnail: provided.thumbnail || `https://i.ytimg.com/vi/${providerId}/hqdefault.jpg`,
      duration: provided.duration,
    };
    cacheMetadata(resolved);
    return resolved;
  }
  const cached = metadataCache.get(providerId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const fallback = {
    title: "YouTube track",
    author_name: "YouTube",
    thumbnail_url: `https://i.ytimg.com/vi/${providerId}/hqdefault.jpg`,
  };

  let metadata = fallback;
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) metadata = { ...fallback, ...(await response.json()) };
  } catch {
    // The canonical URL and thumbnail still make the queue usable if oEmbed is unavailable.
  }

  const resolved = {
    url,
    provider: "youtube" as const,
    providerId,
    title: metadata.title,
    artist: metadata.author_name,
    thumbnail: metadata.thumbnail_url,
  };
  cacheMetadata(resolved);
  return resolved;
}
