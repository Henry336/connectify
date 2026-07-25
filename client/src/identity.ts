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

export type RecentRoom = { code: string; name: string; lastVisited: number };

export function getRecentRooms(): RecentRoom[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("connectify.recentRooms") || "[]"); }
  catch { return []; }
}

export function rememberRoom(code: string, name: string) {
  const rooms = getRecentRooms().filter((room) => room.code !== code.toUpperCase());
  localStorage.setItem("connectify.recentRooms", JSON.stringify([{ code: code.toUpperCase(), name, lastVisited: Date.now() }, ...rooms].slice(0, 5)));
}
