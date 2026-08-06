// YouTube hosts the same song many times over: official video, lyric video, audio-only,
// topic-channel upload, sped-up and slowed edits, reuploads. Each is a distinct videoId,
// so providerId dedupe alone would let the Library fill with variants of one track.
//
// Titles overwhelmingly carry "Artist - Song" plus decoration, while the artist field is
// really the uploading channel (a lyrics channel like "7clouds" for a Foster The People
// song), so the title alone is the more reliable dedupe signal.

const NOISE_SEGMENT = /\b(official|lyrics?|lyric|audio|video|visuali[sz]er|mv|hd|hq|4k|8d|remaster(ed)?|full|complete|explicit|clean|colou?r\s*coded|sub(bed|titles?)?|eng(lish)?\s*sub|vietsub|karaoke|instrumental|cover|reverb|sped\s*up|slowed|nightcore|extended|radio\s*edit|live|performance|session|version|reaction|premiere)\b/i;

// Strips (…) / […] / {…} groups that are decoration rather than part of the title.
function stripNoiseGroups(value: string) {
  return value.replace(/[([{][^)\]}]*[)\]}]/g, (group) => (NOISE_SEGMENT.test(group) ? " " : group));
}

/**
 * A stable key identifying "the same song" across different uploads.
 * Returns an empty string when nothing meaningful survives normalization.
 */
export function normalizeSongKey(title: string): string {
  const cleaned = stripNoiseGroups(String(title || "").toLowerCase());
  // Pipes separate the real title from channel and decoration tails, but the decoration
  // can lead ("Vietsub | Real Title | Lyrics"), so score every segment and keep the
  // most substantial one rather than assuming the title comes first.
  const segments = cleaned.split("|").map((segment) => {
    let value = segment;
    // Decoration that never made it inside brackets.
    value = value.replace(new RegExp(NOISE_SEGMENT.source, "gi"), " ");
    // Featured-artist credits vary per upload for the same recording.
    value = value.replace(/\b(feat|ft|featuring|with)\b\.?.*$/i, " ");
    // Standalone years ("1989 HD") and similar leftovers.
    value = value.replace(/\b(19|20)\d{2}\b/g, " ");
    // Collapse to alphanumerics so punctuation and dash styles stop mattering.
    return value.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).join(" ");
  }).filter(Boolean);
  if (!segments.length) return "";
  return segments.reduce((longest, segment) => (segment.length > longest.length ? segment : longest));
}
