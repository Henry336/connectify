import { useMemo } from "react";
import type { Person, Room } from "../types";

const titleSignals = {
  energy: /party|dance|remix|rock|live|hype|fire|club|festival/g,
  calm: /chill|lofi|sleep|acoustic|slow|ambient|soft/g,
  romance: /love|heart|kiss|baby|falling|forever/g,
  nostalgia: /19\d\d|200\d|throwback|classic|oldies|retro/g,
};

export function useRoomDna(room: Room | null, people: Person[]) {
  return useMemo(() => {
    const tracks = room?.tracks ?? [];
    const contributors = new Set(tracks.map((track) => track.addedByUserId || track.addedBy));
    const artists = new Map<string, number>();
    const contributorCounts = new Map<string, number>();
    for (const track of tracks) {
      artists.set(track.artist, (artists.get(track.artist) || 0) + 1);
      contributorCounts.set(track.addedBy, (contributorCounts.get(track.addedBy) || 0) + 1);
    }
    const topArtist = [...artists.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Waiting for a first artist";
    const topContributor = [...contributorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Nobody yet";
    const titles = tracks.map((track) => `${track.title} ${track.artist}`).join(" ").toLowerCase();
    const energyHits = titles.match(titleSignals.energy)?.length || 0;
    const calmHits = titles.match(titleSignals.calm)?.length || 0;
    const romanceHits = titles.match(titleSignals.romance)?.length || 0;
    const nostalgiaHits = titles.match(titleSignals.nostalgia)?.length || 0;
    const energy = Math.min(100, 28 + energyHits * 11);
    const discovery = tracks.length ? Math.round(artists.size / tracks.length * 100) : 0;
    const togetherness = Math.min(100, contributors.size * 18 + Math.min(people.length, 6) * 8);
    const love = Math.min(100, Math.round((tracks.reduce((sum, track) => sum + track.votes, 0) + (room?.moments.length || 0)) / Math.max(1, tracks.length) * 18));

    const archetype = room?.partyMode === "watch_party"
      ? { name: "Cinema constellation", emoji: "🎬", tagline: "A far-apart front row, perfectly in sync.", accent: "cinema" }
      : room?.partyMode === "blind_pick"
        ? { name: "Mystery frequency", emoji: "🫣", tagline: "Trust the room. The reveal is half the fun.", accent: "mystery" }
        : discovery >= 75
          ? { name: "Curious crate-diggers", emoji: "🧭", tagline: "More new corners than familiar roads.", accent: "discovery" }
          : togetherness >= 75
            ? { name: "One-room chorus", emoji: "🫶", tagline: "Many hands on the queue, one shared pulse.", accent: "together" }
            : energyHits > calmHits
              ? { name: "Neon dancefloor", emoji: "🪩", tagline: "The room keeps choosing motion.", accent: "energy" }
              : calmHits > 0
                ? { name: "After-hours glow", emoji: "🌙", tagline: "Soft edges, long listens, nowhere to rush.", accent: "calm" }
                : romanceHits > 0
                  ? { name: "Soft-heart singalong", emoji: "💜", tagline: "A queue with its feelings showing.", accent: "romance" }
                  : nostalgiaHits > 0
                    ? { name: "Nostalgia transmission", emoji: "📻", tagline: "Old signals, newly shared.", accent: "nostalgia" }
                    : { name: "Eclectic night drive", emoji: "✨", tagline: "No single lane—and that is the point.", accent: "eclectic" };

    return { ...archetype, vibe: `${archetype.emoji} ${archetype.name}`, topArtist, topContributor, energy, discovery, togetherness, love, contributors: contributors.size };
  }, [room?.partyMode, room?.tracks, room?.moments.length, people.length]);
}
