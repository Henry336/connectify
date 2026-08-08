export const GUEST_ADJECTIVES = [
  "Mellow", "Velvet", "Cosmic", "Lucky", "Sunny", "Electric", "Moonlit", "Quiet", "Golden", "Sleepy",
  "Breezy", "Dreamy", "Indigo", "Peachy", "Jazzy", "Lo-Fi", "Radiant", "Wandering", "Soft", "Starlit",
  "Groovy", "Gentle", "Neon", "Cozy", "Curious", "Echoing", "Drowsy", "Silver", "Warm", "Wild",
] as const;

export const GUEST_NOUNS = [
  "Gecko", "Finch", "Fox", "Otter", "Panda", "Koala", "Badger", "Sparrow", "Moth", "Rabbit",
  "Lynx", "Capybara", "Firefly", "Raccoon", "Wren", "Seal", "Owl", "Tiger", "Pigeon", "Whale",
  "Ferret", "Bee", "Cat", "Frog", "Crane", "Dolphin", "Deer", "Bat", "Robin", "Lizard",
] as const;

export const ROOM_NAMES = [
  "Afterglow Radio",
  "Balcony at Midnight",
  "Velvet Static",
  "Moonlit Mixtape",
  "Sunday Slowdown",
  "Neon Daydreams",
  "Rainy Window Radio",
  "Kitchen Dance Break",
  "Starlight Shuffle",
  "Quiet Hours Club",
  "Golden Hour Loop",
  "Late Checkout",
  "Pillow Fort FM",
  "Cosmic Coffeehouse",
  "Soft Launch Sessions",
  "Rooftop Rewind",
  "Comet Tail Club",
  "Vinyl & Violets",
  "Blue Hour Broadcast",
  "Good Company Radio",
  "No-Skip Night",
  "Headphones After Dark",
  "Lavender Frequency",
  "Bedroom Encore",
  "Satellite Serenade",
  "Slow Dance Society",
  "Midnight Snack Mix",
  "Dream Sequence",
  "Warm Lights Only",
  "Side B Social",
  "Cloud Nine Queue",
  "Echoes in the Hall",
  "Fire Escape FM",
  "Tiny Desk Afterparty",
  "Weekend Wind-Down",
  "Moonbeam Assembly",
] as const;

function uniformIndex(length: number) {
  if (length < 1) throw new Error("Cannot choose from an empty name pool.");
  if (typeof crypto === "undefined" || !crypto.getRandomValues) return Math.floor(Math.random() * length);

  const range = 0x1_0000_0000;
  const limit = Math.floor(range / length) * length;
  const sample = new Uint32Array(1);
  do crypto.getRandomValues(sample);
  while (sample[0] >= limit);
  return sample[0] % length;
}

function choose<const T extends readonly string[]>(items: T): T[number] {
  return items[uniformIndex(items.length)];
}

export function randomGuestName() {
  return `${choose(GUEST_ADJECTIVES)} ${choose(GUEST_NOUNS)}`;
}

export function randomRoomName() {
  return choose(ROOM_NAMES);
}
