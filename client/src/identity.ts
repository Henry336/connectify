const adjectives = ["Sunny", "Velvet", "Cosmic", "Mellow", "Lucky", "Electric"];
const nouns = ["Otter", "Finch", "Fox", "Panda", "Koala", "Gecko"];
const avatars = ["🌻", "🪩", "🎧", "🌙", "🛼", "✨"];

export type Identity = { userId: string; name: string; avatar: string };
export const DEFAULT_IDENTITY: Identity = { userId: "", name: "Music fan", avatar: "🎧" };

export function getIdentity(): Identity {
  if (typeof window === "undefined") return DEFAULT_IDENTITY;
  const saved = localStorage.getItem("connectify.identity");
  if (saved) {
    try { return JSON.parse(saved); }
    catch { localStorage.removeItem("connectify.identity"); }
  }
  const identity = {
    userId: crypto.randomUUID(),
    name: `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`,
    avatar: avatars[Math.floor(Math.random() * avatars.length)],
  };
  localStorage.setItem("connectify.identity", JSON.stringify(identity));
  return identity;
}

export function saveIdentity(identity: Identity) {
  if (typeof window === "undefined") return;
  localStorage.setItem("connectify.identity", JSON.stringify(identity));
}

export function getHostToken(code: string) {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(`connectify.host.${code.toUpperCase()}`) || undefined;
}

export function saveHostToken(code: string, token: string) {
  localStorage.setItem(`connectify.host.${code.toUpperCase()}`, token);
}

export function removeHostToken(code: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(`connectify.host.${code.toUpperCase()}`);
}

export type RecentRoom = { code: string; name: string; lastVisited: number };

export function getRecentRooms(): RecentRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem("connectify.recentRooms") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((room): room is RecentRoom => Boolean(
        room
        && typeof room.code === "string"
        && /^[A-Z0-9]{6}$/i.test(room.code)
        && typeof room.name === "string"
        && typeof room.lastVisited === "number",
      ))
      .sort((a, b) => b.lastVisited - a.lastVisited);
  }
  catch { return []; }
}

export function rememberRoom(code: string, name: string) {
  const rooms = getRecentRooms().filter((room) => room.code !== code.toUpperCase());
  localStorage.setItem("connectify.recentRooms", JSON.stringify([
    { code: code.toUpperCase(), name, lastVisited: Date.now() },
    ...rooms,
  ]));
}

export function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem("connectify.recentSearches") || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8) : [];
  }
  catch { return []; }
}

export function rememberSearch(query: string) {
  if (typeof window === "undefined") return;
  const trimmed = query.trim();
  if (!trimmed) return;
  const next = [trimmed, ...getRecentSearches().filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
  try { localStorage.setItem("connectify.recentSearches", JSON.stringify(next)); }
  catch { /* Recent searches are best-effort. */ }
}

export type RecentAdd = { providerId: string; title: string; artist: string; thumbnail: string | null; url: string; duration: number | null };

export function getRecentAdds(): RecentAdd[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem("connectify.recentAdds") || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is RecentAdd => Boolean(item && typeof item.providerId === "string" && typeof item.title === "string" && typeof item.url === "string")).slice(0, 6)
      : [];
  }
  catch { return []; }
}

export function rememberRecentAdd(item: RecentAdd) {
  if (typeof window === "undefined") return;
  const next = [item, ...getRecentAdds().filter((existing) => existing.providerId !== item.providerId)].slice(0, 6);
  try { localStorage.setItem("connectify.recentAdds", JSON.stringify(next)); }
  catch { /* Recently added tracks are best-effort. */ }
}
