import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSongKey } from "./song-key.js";

test("collapses the common upload variants of one song to a single key", () => {
  const key = normalizeSongKey("Foster The People - Pumped Up Kicks (Official Video)");
  for (const variant of [
    "Foster The People - Pumped Up Kicks (Lyrics)",
    "Foster The People - Pumped Up Kicks [Official Audio]",
    "Foster The People - Pumped Up Kicks (Official Music Video)",
    "Foster The People - Pumped Up Kicks (Lyrics) | 7clouds",
    "foster the people — pumped up kicks (HD)",
  ]) {
    assert.equal(normalizeSongKey(variant), key, variant);
  }
});

test("strips trailing year and resolution decoration", () => {
  assert.equal(
    normalizeSongKey("Kaoma - Lambada (Official Video) 1989 HD"),
    normalizeSongKey("Kaoma - Lambada"),
  );
});

test("strips subtitle and lyric-channel decoration around the title", () => {
  assert.equal(
    normalizeSongKey("Vietsub | Are You Satisfied? - Marina & The Diamonds | Lyrics Video"),
    normalizeSongKey("Are You Satisfied? - Marina & The Diamonds"),
  );
});

test("treats featured-artist credits as the same recording", () => {
  assert.equal(
    normalizeSongKey("Artist - Song (feat. Someone Else)"),
    normalizeSongKey("Artist - Song"),
  );
});

test("keeps genuinely different songs apart", () => {
  const pumped = normalizeSongKey("Foster The People - Pumped Up Kicks");
  assert.notEqual(pumped, normalizeSongKey("Foster The People - Sit Next to Me"));
  assert.notEqual(pumped, normalizeSongKey("Ed Sheeran - Eyes Closed"));
  assert.notEqual(normalizeSongKey("Imagine Dragons - Wake Up"), normalizeSongKey("Imagine Dragons - Believer"));
});

test("does not fold a parenthetical that is part of the actual title", () => {
  assert.notEqual(
    normalizeSongKey("Ricky Martin - La Copa de la Vida"),
    normalizeSongKey("Ricky Martin - La Copa de la Vida (Spanglish)"),
  );
});

test("returns an empty key for titles with nothing to normalize", () => {
  assert.equal(normalizeSongKey(""), "");
  assert.equal(normalizeSongKey("(Official Video)"), "");
  assert.equal(normalizeSongKey(undefined as unknown as string), "");
});
