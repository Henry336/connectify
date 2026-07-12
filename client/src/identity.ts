const adjectives = ["Sunny", "Velvet", "Cosmic", "Mellow", "Lucky", "Electric"];
const nouns = ["Otter", "Finch", "Fox", "Panda", "Koala", "Gecko"];
const avatars = ["🌻", "🪩", "🎧", "🌙", "🛼", "✨"];

export type Identity = { userId: string; name: string; avatar: string };

export function getIdentity(): Identity {
  const saved = localStorage.getItem("connectify.identity");
  if (saved) return JSON.parse(saved);
  const identity = {
    userId: crypto.randomUUID(),
    name: `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`,
    avatar: avatars[Math.floor(Math.random() * avatars.length)],
  };
  localStorage.setItem("connectify.identity", JSON.stringify(identity));
  return identity;
}

export function saveIdentity(identity: Identity) {
  localStorage.setItem("connectify.identity", JSON.stringify(identity));
}

export function getHostToken(code: string) {
  return localStorage.getItem(`connectify.host.${code.toUpperCase()}`) || undefined;
}

export function saveHostToken(code: string, token: string) {
  localStorage.setItem(`connectify.host.${code.toUpperCase()}`, token);
}

export type RecentRoom = { code: string; name: string; lastVisited: number };

export function getRecentRooms(): RecentRoom[] {
  try { return JSON.parse(localStorage.getItem("connectify.recentRooms") || "[]"); }
  catch { return []; }
}

export function rememberRoom(code: string, name: string) {
  const rooms = getRecentRooms().filter((room) => room.code !== code.toUpperCase());
  localStorage.setItem("connectify.recentRooms", JSON.stringify([{ code: code.toUpperCase(), name, lastVisited: Date.now() }, ...rooms].slice(0, 5)));
}
