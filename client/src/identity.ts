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
