export type ResolvedTrack = {
  url: string;
  provider: "youtube";
  providerId: string;
  title: string;
  artist: string;
  thumbnail: string;
};

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

export async function resolveTrack(value: string): Promise<ResolvedTrack> {
  const providerId = getYouTubeId(value);
  if (!providerId) throw new Error("Paste a valid YouTube video or music URL.");

  const url = `https://www.youtube.com/watch?v=${providerId}`;
  const fallback = {
    title: "YouTube track",
    author_name: "YouTube",
    thumbnail_url: `https://i.ytimg.com/vi/${providerId}/hqdefault.jpg`,
  };

  let metadata = fallback;
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) metadata = { ...fallback, ...(await response.json()) };
  } catch {
    // The canonical URL and thumbnail still make the queue usable if oEmbed is unavailable.
  }

  return {
    url,
    provider: "youtube",
    providerId,
    title: metadata.title,
    artist: metadata.author_name,
    thumbnail: metadata.thumbnail_url,
  };
}
