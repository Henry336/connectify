import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./room-service.js";

export type SearchItem = {
  providerId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  url: string;
  duration: number | null;
  source: "connectify" | "youtube";
};

export type YouTubeSearchResponse = { items: SearchItem[]; nextPageToken: string | null; cached: boolean };

export function normalizeSearchQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);
}

export function uniqueSearchItems(items: SearchItem[], limit = 30) {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.providerId) && Boolean(seen.add(item.providerId))).slice(0, limit);
}

const asSearchItem = (track: { providerId: string; title: string; artist: string; thumbnail: string | null; url: string; duration: number | null }): SearchItem => ({ ...track, source: "connectify" });

export async function searchConnectifyLibrary(rawQuery: string, roomCode: string) {
  const query = normalizeSearchQuery(rawQuery);
  const textFilter = { OR: [{ title: { contains: query, mode: Prisma.QueryMode.insensitive } }, { artist: { contains: query, mode: Prisma.QueryMode.insensitive } }] };
  const select = { providerId: true, title: true, artist: true, thumbnail: true, url: true, duration: true } as const;
  const [roomTracks, discoveryTracks] = await Promise.all([
    prisma.track.findMany({ where: { removedAt: null, room: { code: roomCode }, ...textFilter }, select, orderBy: [{ votes: "desc" }, { createdAt: "desc" }], take: 30 }),
    prisma.track.findMany({ where: { removedAt: null, room: { discoverable: true }, ...textFilter }, select, orderBy: [{ votes: "desc" }, { createdAt: "desc" }], take: 60 }),
  ]);
  return uniqueSearchItems([...roomTracks.map(asSearchItem), ...discoveryTracks.map(asSearchItem)]);
}

const memoryCache = new Map<string, { expiresAt: number; value: YouTubeSearchResponse }>();
const inFlight = new Map<string, Promise<YouTubeSearchResponse>>();
const MEMORY_TTL = 15 * 60 * 1000;
const DATABASE_TTL = 24 * 60 * 60 * 1000;
const MAX_MEMORY_ENTRIES = 300;

const cacheKey = (query: string, pageToken?: string) => createHash("sha256").update(`${query}\n${pageToken || "first"}`).digest("hex");
const touchMemory = (key: string, value: YouTubeSearchResponse) => {
  memoryCache.delete(key);
  memoryCache.set(key, { expiresAt: Date.now() + MEMORY_TTL, value });
  while (memoryCache.size > MAX_MEMORY_ENTRIES) memoryCache.delete(memoryCache.keys().next().value!);
};
const decodeTitle = (value: string) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export async function searchYouTube(rawQuery: string, pageToken?: string): Promise<YouTubeSearchResponse> {
  const query = normalizeSearchQuery(rawQuery);
  const key = cacheKey(query, pageToken);
  const memory = memoryCache.get(key);
  if (memory && memory.expiresAt > Date.now()) {
    memoryCache.delete(key); memoryCache.set(key, memory);
    return { ...memory.value, cached: true };
  }
  const stored = await prisma.searchCache.findUnique({ where: { key } });
  if (stored && stored.expiresAt > new Date()) {
    const value = stored.response as unknown as YouTubeSearchResponse;
    touchMemory(key, value);
    return { ...value, cached: true };
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const params = new URLSearchParams({ key: process.env.YOUTUBE_API_KEY!, part: "snippet", q: query, type: "video", maxResults: "25", videoEmbeddable: "true", safeSearch: "moderate" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) { const error: any = new Error("YouTube search failed."); error.status = response.status; throw error; }
    const data = await response.json() as any;
    const value: YouTubeSearchResponse = {
      items: (data.items || []).filter((item: any) => item.id?.videoId).map((item: any) => ({
        providerId: item.id.videoId,
        title: decodeTitle(item.snippet.title),
        artist: decodeTitle(item.snippet.channelTitle),
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        duration: null,
        source: "youtube" as const,
      })),
      nextPageToken: data.nextPageToken || null,
      cached: false,
    };
    const expiresAt = new Date(Date.now() + DATABASE_TTL);
    void prisma.searchCache.upsert({ where: { key }, create: { key, query, pageToken, response: value as unknown as Prisma.InputJsonValue, expiresAt }, update: { response: value as unknown as Prisma.InputJsonValue, expiresAt } })
      .catch((error) => console.warn("Could not persist search cache", error));
    if (Math.random() < 0.02) void prisma.searchCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    touchMemory(key, value);
    return value;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
