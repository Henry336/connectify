// A rotating, genre/mood/decade-diverse query list for growing the Connectify Library
// automatically. Kept broad on purpose so gap-fill ranking (see pickSeedQueries) has real
// room to prioritize whichever styles the library is thinnest on.
export const SEED_QUERIES = [
  "lofi hip hop", "2000s pop punk", "k-pop 2024", "classic soul", "90s r&b",
  "indie folk", "synthwave", "bedroom pop", "afrobeats", "latin pop",
  "jazz standards", "chillhop", "j-pop", "hyperpop", "dream pop",
  "trap", "bossa nova", "uk garage", "boom bap hip hop", "shoegaze",
  "disco funk", "reggaeton", "post punk", "ambient electronic", "drum and bass",
  "country 2024", "emo rap", "city pop", "neo soul", "punk rock",
  "house music", "singer songwriter acoustic", "grunge", "gospel", "salsa",
  "phonk", "alt rock 2020s", "bachata", "trip hop", "melodic techno",
  "80s new wave", "worship music", "amapiano", "math rock", "vaporwave",
  "flamenco", "bluegrass", "hardstyle", "orchestral film score", "lo-fi jazz",
] as const;

export type SeedCandidate = { query: string; lastSearchedAt: Date | string | null; coverage: number };

// Chooses which seed queries to run this pass: queries never searched before come first,
// then the ones with the fewest existing Library matches, with staleness as the tiebreak.
// This is what keeps a fixed daily budget from just circling the same handful of genres.
export function pickSeedQueries(candidates: SeedCandidate[], budget: number): string[] {
  if (budget <= 0) return [];
  const ranked = [...candidates].sort((a, b) => {
    const aNever = a.lastSearchedAt === null;
    const bNever = b.lastSearchedAt === null;
    if (aNever !== bNever) return aNever ? -1 : 1;
    if (a.coverage !== b.coverage) return a.coverage - b.coverage;
    return new Date(a.lastSearchedAt || 0).getTime() - new Date(b.lastSearchedAt || 0).getTime();
  });
  return ranked.slice(0, budget).map((item) => item.query);
}
