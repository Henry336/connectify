// A rotating, genre/mood/decade/region-diverse query catalog for growing the Connectify
// Library automatically. Kept large and broad on purpose: at ~100 searches a day the job
// would otherwise circle the same few styles within a week, and each query is also paged
// through over time (see pickSeedTargets) so a single query keeps yielding new songs.
export const SEED_QUERIES = [
  // Core genres
  "lofi hip hop", "boom bap hip hop", "trap", "emo rap", "drill",
  "indie folk", "indie rock", "alt rock", "post punk", "punk rock",
  "shoegaze", "dream pop", "bedroom pop", "math rock", "grunge",
  "synthwave", "vaporwave", "phonk", "hyperpop", "chillhop",
  "house music", "deep house", "melodic techno", "drum and bass", "hardstyle",
  "dubstep", "ambient electronic", "trip hop", "uk garage", "jungle",
  "jazz standards", "smooth jazz", "lo-fi jazz", "bossa nova", "neo soul",
  "classic soul", "motown", "funk", "disco funk", "gospel",
  "blues", "bluegrass", "folk americana", "country classics", "country 2024",
  "singer songwriter acoustic", "orchestral film score", "classical piano", "string quartet", "opera arias",
  // Regional and language
  "k-pop", "k-pop ballads", "j-pop", "city pop", "j-rock",
  "c-pop", "mandopop", "cantopop", "thai pop", "v-pop",
  "afrobeats", "amapiano", "highlife", "afro house", "nigerian gospel",
  "latin pop", "reggaeton", "bachata", "salsa", "cumbia",
  "mexican corridos", "flamenco", "brazilian funk", "mpb brazilian", "samba",
  "bollywood hits", "punjabi music", "tamil hits", "arabic pop", "turkish pop",
  "french chanson", "german pop", "italian pop", "russian pop", "nordic indie",
  "reggae", "dancehall", "soca", "ska", "afrobeat fela",
  // Decades
  "60s rock", "70s rock", "80s new wave", "80s pop hits", "90s r&b",
  "90s alternative", "2000s pop punk", "2000s r&b", "2010s indie", "2020s pop",
  "70s soul", "90s hip hop", "2000s hip hop", "60s motown", "80s synth pop",
  // Moods and activities
  "study music", "focus instrumental", "sleep music", "meditation music", "rainy day songs",
  "workout music", "running playlist", "road trip songs", "party anthems", "summer hits",
  "sad songs", "breakup songs", "love songs", "wedding songs", "feel good songs",
  "morning coffee music", "late night drive", "cozy autumn music", "winter acoustic", "beach chill",
  "wholesome acoustic covers", "piano covers", "guitar instrumental", "a cappella covers", "live acoustic sessions",
  // Formats and niches
  "anime openings", "video game soundtrack", "movie soundtrack", "musical theatre", "christmas music",
  "worship music", "instrumental hip hop beats", "jazz fusion", "progressive rock", "psychedelic rock",
  "hard rock", "heavy metal", "metalcore", "post rock", "experimental electronic",
  "new music friday", "rising artists", "acoustic singer songwriter 2024", "viral songs", "underground hip hop",
] as const;

export type SeedCandidate = {
  query: string;
  lastSearchedAt: Date | string | null;
  coverage: number;
  exhausted?: boolean;
};

// Chooses which seed queries to run next: never-searched queries come first, then the
// ones with the fewest existing Library matches, with staleness as the tiebreak. Queries
// YouTube has no more pages for are skipped entirely. This is what keeps a fixed budget
// from just circling the same handful of genres as the catalog fills in.
export function pickSeedTargets(candidates: SeedCandidate[], budget: number): string[] {
  if (budget <= 0) return [];
  const ranked = candidates
    .filter((item) => !item.exhausted)
    .sort((a, b) => {
      const aNever = a.lastSearchedAt === null;
      const bNever = b.lastSearchedAt === null;
      if (aNever !== bNever) return aNever ? -1 : 1;
      if (a.coverage !== b.coverage) return a.coverage - b.coverage;
      return new Date(a.lastSearchedAt || 0).getTime() - new Date(b.lastSearchedAt || 0).getTime();
    });
  return ranked.slice(0, budget).map((item) => item.query);
}
